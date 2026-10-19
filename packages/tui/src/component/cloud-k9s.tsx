import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { InstallationVersion } from "@rsmrtk/core/installation/version"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { runInteractive } from "../editor"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import {
  HEADER_ROWS,
  bottomBorder as chromeBottomBorder,
  crumbsLine,
  flashLine as chromeFlashLine,
  frameTitle as chromeFrameTitle,
  frameTitleLength,
  headerLine as chromeHeaderLine,
  pad,
  promptBox as chromePromptBox,
  sideLine as chromeSideLine,
  topBorder as chromeTopBorder,
  type Flash,
  type Hotkey,
} from "./k9s-chrome"
import { K9S, defaultSort, filterRows, isRightAligned, sortRows, toTable, type Row, type Sort, type Table } from "./kube-k9s-model"

// The /cloud browser in the same k9s skin as /k8s — AWS names instead of
// Kubernetes ones: services rather than kinds, a region rather than a
// namespace, an account rather than a cluster. Read-only like everything else
// here: it lists, the agent acts.

type Service = { key: string; label: string; noun: string }
type View = { type: "services" } | { type: "table"; service: string; filter: string; sort?: Sort; selKey?: string } | { type: "help" }

// Regions on the number keys, the way k9s keeps namespaces on 0-9. 0 is
// whatever the aws CLI is configured for.
const REGIONS = ["default", "us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"]

const PROBLEM = /(failed|error|terminated|deleted|impaired|unhealthy|inactive)/i
const BUSY = /(pending|creating|updating|modifying|starting|stopping|provisioning|shutting|deleting)/i
const IDLE = /(stopped|disabled)/i

function rowColor(table: Table, row: Row): string {
  const index = table.columns.findIndex((column) => ["STATE", "STATUS"].includes(column))
  const state = index >= 0 ? (row.cells[index] ?? "") : ""
  if (PROBLEM.test(state)) return K9S.orangeRed
  if (BUSY.test(state)) return K9S.darkOrange
  if (IDLE.test(state)) return K9S.slate
  return K9S.sky
}

export function CloudK9s() {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const clipboard = useClipboard()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  onMount(() => dialog.setSize("full"))

  const [region, setRegion] = createSignal("")
  const [info, setInfo] = createSignal<{ profile: string; account: string; identity: string; region: string }>()
  const [services, setServices] = createSignal<Service[]>([])
  // undefined means the count call failed (no credentials, no access) — drawn grey like an empty service.
  const [counts, setCounts] = createSignal<Record<string, number | undefined>>({})
  const [table, setTable] = createSignal<Table>()
  const [loadError, setLoadError] = createSignal<string>()
  const [flash, setFlash] = createSignal<Flash | undefined>({ text: "Viewing aws services" })
  const [prompt, setPrompt] = createSignal<{ kind: ":" | "/"; value: string }>()
  const [selected, setSelected] = createSignal(0)
  const [top, setTop] = createSignal(0)
  const [store, setStore] = createStore<{ stack: View[] }>({ stack: [{ type: "services" }] })

  const view = createMemo(() => store.stack.at(-1)!)
  const W = () => dimensions().width
  const inner = () => W() - 2
  const regionName = () => region() || info()?.region || "default"

  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const say = (message: string, error = false) => {
    if (flashTimer) clearTimeout(flashTimer)
    setFlash({ text: message, error })
    flashTimer = setTimeout(() => setFlash(undefined), error ? 6000 : 3000)
  }
  onCleanup(() => flashTimer && clearTimeout(flashTimer))

  const reset = () => {
    setSelected(0)
    setTop(0)
    setTable(undefined)
    setLoadError(undefined)
  }

  const push = (next: View) => {
    setStore("stack", (stack) => [...stack, next])
    reset()
  }

  const back = () => {
    if (store.stack.length <= 1) return dialog.clear()
    setStore("stack", (stack) => stack.slice(0, -1))
    reset()
  }

  const patchView = (patch: Partial<Extract<View, { type: "table" }>>) => setStore("stack", store.stack.length - 1, patch)

  // ---------------------------------------------------------------- data

  const refreshInfo = () =>
    sdk.client.experimental.cloud.context().then(
      (result) => result.data && setInfo(result.data),
      () => undefined,
    )
  void refreshInfo()

  sdk.client.experimental.cloud.services({}).then(
    (result) => result.data && setServices([...result.data]),
    () => undefined,
  )

  const listing = (service: string) => sdk.client.experimental.cloud.resources({ service, ...(region() ? { region: region() } : {}) })

  const loadKey = createMemo(() => {
    const v = view()
    return JSON.stringify([store.stack.length, v.type, region(), v.type === "table" ? v.service : "", services().length])
  })

  const load = async (key: string) => {
    const v = view()
    if (v.type === "services") {
      const entries = await Promise.all(
        services().map(async (service) => [service.key, await listing(service.key).then((r) => r.data?.rows.length, () => undefined)] as const),
      )
      if (key === loadKey()) setCounts(Object.fromEntries(entries))
      return
    }
    if (v.type !== "table") return
    const result = await listing(v.service).catch((error: unknown) => ({ data: undefined, error: { message: error instanceof Error ? error.message : String(error) } }))
    if (key !== loadKey()) return
    if (!result.data) {
      const message = result.error && "message" in result.error ? String(result.error.message) : "aws CLI failed"
      setLoadError(message)
      say(message, true)
      return
    }
    setTable(toTable(result.data))
    setLoadError(undefined)
  }

  createEffect(on(loadKey, (key) => void load(key)))

  // AWS calls are slower and rate-limited, so tables refresh at a gentler beat than /k8s.
  const timer = setInterval(() => {
    if (view().type === "table") void load(loadKey())
  }, 10_000)
  onCleanup(() => clearInterval(timer))

  // ---------------------------------------------------------------- derived

  const sort = createMemo(() => {
    const t = table()
    const v = view()
    return t ? (v.type === "table" && v.sort ? v.sort : defaultSort(t.columns)) : undefined
  })

  const rows = createMemo<Row[]>(() => {
    const t = table()
    const v = view()
    if (!t || v.type !== "table") return []
    return filterRows(sortRows(t, sort()!), v.filter)
  })

  const serviceRows = createMemo<Row[]>(() =>
    services().map((service) => ({ name: service.key, cells: [service.key, service.label, service.noun, String(counts()[service.key] ?? "-")] })),
  )

  const bodyRows = () => {
    const base = dimensions().height - 12 - (prompt() ? 3 : 0)
    return Math.max(1, view().type === "help" ? base + 1 : base)
  }

  const listLength = () => (view().type === "services" ? serviceRows().length : rows().length)
  const currentRow = () => (view().type === "services" ? serviceRows()[selected()] : rows()[selected()])

  const clampSelection = (index: number) => {
    const next = Math.min(Math.max(0, listLength() - 1), Math.max(0, index))
    setSelected(next)
    if (next < top()) setTop(next)
    else if (next >= top() + bodyRows()) setTop(next - bodyRows() + 1)
    const current = currentRow()
    if (current && view().type === "table") patchView({ selKey: current.name })
  }

  // After a refresh the cursor stays on the same resource, not the same index.
  createEffect(
    on(rows, (list) => {
      const v = view()
      if (v.type !== "table" || !v.selKey) return
      const found = list.findIndex((row) => row.name === v.selKey)
      if (found >= 0 && found !== selected()) setSelected(found)
      else if (found < 0 && selected() >= list.length) setSelected(Math.max(0, list.length - 1))
    }),
  )

  // ---------------------------------------------------------------- actions

  const resolveService = (word: string) => {
    const lower = word.toLowerCase()
    return services().find(
      (service) => service.key === lower || service.label.toLowerCase() === lower || service.noun.toLowerCase() === lower || `${service.noun.toLowerCase()}s` === lower,
    )
  }

  const openService = (word: string) => {
    const service = resolveService(word)
    if (!service) return say(`Unknown AWS service "${word}" — try ${services().map((item) => item.key).join(", ")}.`, true)
    push({ type: "table", service: service.key, filter: "" })
    say(`Viewing aws ${service.key} in ${regionName()}`)
  }

  const useRegion = (name: string) => {
    setRegion(name === "default" ? "" : name)
    say(`Viewing region ${name}`)
  }

  const runCommand = (value: string) => {
    const [head, ...rest] = value.trim().split(/\s+/)
    if (!head) return
    const word = head.toLowerCase()
    if (["q", "quit", "q!", "exit"].includes(word)) return dialog.clear()
    if (["help", "?"].includes(word)) return push({ type: "help" })
    if (["alias", "aliases", "services", "svc", "a"].includes(word)) return push({ type: "services" })
    if (["login", "signin", "l"].includes(word)) return void signIn("login")
    if (word === "sso") return void signIn("sso")
    if (["configure", "keys"].includes(word)) return void signIn("configure")
    if (["region", "rg"].includes(word) && rest[0]) return useRegion(rest[0])
    openService(word)
    if (rest[0]?.startsWith("/")) patchView({ filter: rest[0].slice(1) })
  }

  // Tail of the first service name or alias that starts with what was typed.
  const suggest = (typed: string) => {
    const word = typed.trim().toLowerCase()
    if (!word || /\s/.test(typed.trim())) return ""
    const names = services().flatMap((service) => [service.key, service.label.toLowerCase(), service.noun.toLowerCase()])
    const hit = names.find((name) => name.startsWith(word) && name !== word)
    return hit ? hit.slice(word.length) : ""
  }

  const toggleSort = (column: string) => {
    const t = table()
    if (!t?.columns.includes(column)) return say(`No ${column} column here.`, true)
    patchView({ sort: { column, desc: sort()?.column === column ? !sort()!.desc : false } })
  }

  const copy = (value: string, label: string) => {
    if (!clipboard.write) return say("Clipboard not available.", true)
    void clipboard.write(value).then(
      () => say(`${label} copied to clipboard`),
      (error) => toast.error(error),
    )
  }

  // Sign-in hands the terminal to the aws CLI (browser login, SSO or access
  // keys), then re-reads who we are. Credentials stay in ~/.aws — nami stores nothing.
  const SIGN_IN: Record<string, { args: string[]; label: string }> = {
    login: { args: ["login"], label: "aws login (browser)" },
    sso: { args: ["configure", "sso"], label: "aws configure sso" },
    configure: { args: ["configure"], label: "aws configure (access keys)" },
  }

  const signIn = async (kind: keyof typeof SIGN_IN) => {
    const { args, label } = SIGN_IN[kind]!
    say(`Running ${label}…`)
    const code = await runInteractive({ renderer, command: "aws", args }).catch((error: unknown) => {
      say(error instanceof Error && "code" in error && error.code === "ENOENT" ? "aws CLI not installed — brew install awscli" : String(error), true)
      return undefined
    })
    if (code === undefined) return
    await refreshInfo()
    reset()
    setCounts({})
    void load(loadKey())
    if (code !== 0) return say(`${label} exited with code ${code}`, true)
    say(info()?.account ? `Signed in to account ${info()!.account}` : "Not signed in yet — press L to try again", !info()?.account)
  }

  const move = (delta: number) => clampSelection(selected() + delta)

  const enter = () => {
    const row = currentRow()
    if (!row) return
    if (view().type === "services") return openService(row.name)
    say("Listing only — ask the agent to act on this resource.")
  }

  // ---------------------------------------------------------------- keys

  // Escape goes through the keymap: the dialog's own escape binding would close everything.
  useBindings(() => ({
    bindings: [
      {
        key: "escape",
        desc: "Back",
        group: "Dialog",
        cmd: () => {
          if (prompt()) return setPrompt(undefined)
          const v = view()
          if (v.type === "table" && v.filter) return patchView({ filter: "" })
          back()
        },
      },
    ],
  }))

  useKeyboard((evt) => {
    evt.preventDefault()
    evt.stopPropagation()
    const p = prompt()
    if (p) {
      if (evt.name === "return") {
        setPrompt(undefined)
        // Enter runs exactly what is in the prompt; Tab is what completes it.
        if (p.kind === ":") return runCommand(p.value)
        if (view().type === "table") patchView({ filter: p.value })
        return
      }
      if (evt.name === "backspace") return setPrompt({ kind: p.kind, value: p.value.slice(0, -1) })
      if (evt.ctrl && evt.name === "u") return setPrompt({ kind: p.kind, value: "" })
      if (evt.name === "tab" || evt.name === "right") return p.kind === ":" ? setPrompt({ kind: ":", value: p.value + suggest(p.value) }) : undefined
      const seq = evt.sequence
      if (evt.ctrl || evt.meta || !seq || seq.length !== 1 || seq < " ") return
      const value = p.value + seq
      setPrompt({ kind: p.kind, value })
      if (p.kind === "/" && view().type === "table") {
        patchView({ filter: value })
        setSelected(0)
        setTop(0)
      }
      return
    }

    const v = view()
    const row = currentRow()
    const seq = evt.sequence
    const name = evt.name

    if (evt.ctrl && name === "c") return dialog.clear()
    if (seq === ":") return setPrompt({ kind: ":", value: "" })
    if (seq === "/" && v.type === "table") return setPrompt({ kind: "/", value: v.filter })
    if (seq === "L" && v.type !== "help") return void signIn("login")
    if (seq === "?") return v.type === "help" ? back() : push({ type: "help" })
    if (evt.ctrl && name === "a") return push({ type: "services" })
    if (evt.ctrl && name === "r") return void load(loadKey())
    if (name === "q" && !evt.ctrl) return back()

    // Region keys: 0 = the CLI's default, 1..9 = favourites.
    if (seq && /^[0-9]$/.test(seq) && v.type !== "help") {
      const chosen = REGIONS[Number(seq)]
      if (chosen) useRegion(chosen)
      return
    }

    if (name === "up" || seq === "k") return move(-1)
    if (name === "down" || seq === "j") return move(1)
    if (name === "pageup" || (evt.ctrl && name === "b")) return move(-bodyRows())
    if (name === "pagedown" || (evt.ctrl && name === "f")) return move(bodyRows())
    if (name === "home" || seq === "g") return clampSelection(0)
    if (name === "end" || seq === "G") return clampSelection(listLength() - 1)
    if (name === "return") return enter()

    if (v.type === "table") {
      if (seq === "N") return toggleSort(table()?.columns[0] ?? "NAME")
      if (seq === "S") return toggleSort(table()?.columns.find((column) => ["STATE", "STATUS"].includes(column)) ?? "STATE")
      if (seq === "c" && row) return copy(row.name, "Name")
    }
  })

  // ---------------------------------------------------------------- menu

  const menu = createMemo<Hotkey[]>(() => {
    const common: Hotkey[] = [{ key: "?", desc: "Help" }, { key: "L", desc: "Login" }, { key: "ctrl-a", desc: "Services" }, { key: "ctrl-r", desc: "Refresh" }]
    const v = view()
    if (v.type === "help") return [{ key: "esc", desc: "Back" }]
    if (v.type === "services") return [{ key: "enter", desc: "Open" }, ...common]
    return [...common, { key: "c", desc: "Copy" }, { key: "shift-n", desc: "Sort Name" }, { key: "shift-s", desc: "Sort State" }].sort((a, b) => a.key.localeCompare(b.key))
  })

  // ---------------------------------------------------------------- render

  const frameColor = () => (prompt() ? K9S.dodger : K9S.sky)
  const sideLine = (children: JSX.Element, background?: string) => chromeSideLine({ color: frameColor(), children, background })
  const emptyLine = () => sideLine(<span>{" ".repeat(inner())}</span>)

  const titleParts = () => {
    const v = view()
    if (v.type === "services") return { name: "services", scope: regionName(), count: serviceRows().length }
    if (v.type === "table") return { name: v.service, scope: regionName(), count: rows().length, filter: v.filter }
    return undefined
  }

  const headerLine = (index: number) => {
    const i = info()
    return chromeHeaderLine({
      index,
      width: W(),
      menu: menu(),
      numbers: REGIONS,
      numberWidth: 14,
      labels: [
        ["Profile:", i?.profile ?? "…"],
        ["Account:", i?.account || "not signed in"],
        ["Identity:", (i?.identity ?? "").split(":").at(-1) ?? ""],
        ["Region:", regionName()],
        ["Nami Rev:", String(InstallationVersion)],
      ],
    })
  }

  const topBorder = () => {
    const parts = titleParts()
    return chromeTopBorder({
      width: W(),
      color: frameColor(),
      title: parts ? chromeFrameTitle(parts) : <span style={{ fg: K9S.aqua, bold: true }}>Help</span>,
      titleLength: parts ? frameTitleLength(parts) : 4,
    })
  }

  const layout = createMemo(() => {
    const t = table()
    if (!t || view().type !== "table") return undefined
    const widths = t.columns.map((column, index) => Math.max(column.length + (column === sort()?.column ? 1 : 0), ...rows().map((row) => (row.cells[index] ?? "").length)) + 2)
    let total = widths.reduce((a, b) => a + b, 0)
    while (total > inner() - 1) {
      const widest = widths.indexOf(Math.max(...widths))
      if (widths[widest]! <= 10) break
      widths[widest]!--
      total--
    }
    return widths
  })

  const columnHeader = (): JSX.Element => {
    const t = table()
    const widths = layout()
    const s = sort()
    if (!t || !widths) return <text> </text>
    return sideLine(
      <>
        <span> </span>
        {t.columns.map((column, index) => {
          const active = column === s?.column
          const arrow = active ? (s!.desc ? "↓" : "↑") : ""
          const room = widths[index]! - column.length - arrow.length
          return (
            <>
              <span>{isRightAligned(column) ? " ".repeat(Math.max(0, room - 1)) : ""}</span>
              <span style={{ fg: active ? K9S.sky : K9S.white }}>{column}</span>
              <span style={{ fg: K9S.aqua, bold: true }}>{arrow}</span>
              <span>{isRightAligned(column) ? " " : " ".repeat(Math.max(0, room))}</span>
            </>
          )
        })}
        <span>{" ".repeat(Math.max(0, inner() - 1 - widths.reduce((a, b) => a + b, 0)))}</span>
      </>,
    )
  }

  const rowLine = (row: Row, index: number): JSX.Element => {
    const t = table()!
    const widths = layout()!
    const active = index === selected()
    const text = " " + t.columns.map((column, c) => (isRightAligned(column) ? pad(row.cells[c] ?? "", widths[c]! - 1, true) + " " : pad(row.cells[c] ?? "", widths[c]!))).join("")
    return sideLine(
      <span style={{ fg: active ? K9S.black : rowColor(t, row), bg: active ? K9S.sky : undefined, bold: active }}>{pad(text, inner())}</span>,
    )
  }

  // The service list is where "available vs. not" shows: a service with
  // resources is k9s blue, one that is empty or unreachable is grey.
  const serviceHeader = () =>
    sideLine(<span style={{ fg: K9S.white }}>{pad(" " + pad("NAME", 9) + pad("SERVICE", 20) + pad("LISTS", 24) + pad("COUNT", 8, true), inner())}</span>)

  const serviceLine = (row: Row, index: number): JSX.Element => {
    const active = index === selected()
    const count = Number(row.cells[3])
    const color = active ? K9S.black : count > 0 ? K9S.sky : K9S.slate
    const text = " " + pad(row.cells[0]!, 9) + pad(row.cells[1]!, 20) + pad(row.cells[2]!, 24) + pad(row.cells[3]!, 8, true)
    return sideLine(<span style={{ fg: color, bg: active ? K9S.sky : undefined, bold: active }}>{pad(text, inner())}</span>)
  }

  const helpBody = (): JSX.Element[] => {
    const columns = [
      ["<0>        default region", "<1…5>      favourite region", "<c>        Copy name", "<ctrl-r>   Refresh", "<shift-l>  Sign in (aws login)", "<shift-n>  Sort Name", "<shift-s>  Sort State"],
      ["<ctrl-a>   Services", "<q>        Back", "<esc>      Back/Clear", "<:cmd>     Command mode", "</term>    Filter mode", "<?>        Help", "<:q>       Quit", "<:login>   aws login", "<:sso>     aws configure sso", "<:keys>    aws configure", "<enter>    Open service", "<tab>      Complete command"],
      ["<j>        Down", "<k>        Up", "<g>        Goto Top", "<shift-g>  Goto Bottom", "<ctrl-f>   Page Down", "<ctrl-b>   Page Up"],
    ]
    const width = Math.floor((inner() - 2) / 3)
    const heads = ["RESOURCE", "GENERAL", "NAVIGATION"]
    const header = sideLine(<span style={{ fg: K9S.sky }}>{" " + heads.map((head) => pad(head, width)).join("") + " ".repeat(Math.max(0, inner() - 1 - width * 3))}</span>)
    const lines = Array.from({ length: Math.max(...columns.map((column) => column.length)) }, (_, line) =>
      sideLine(
        <>
          <span> </span>
          {columns.map((column) => {
            const entry = column[line] ?? ""
            const split = entry.indexOf(">") + 1
            return (
              <>
                <span style={{ fg: K9S.dodger, bold: true }}>{entry.slice(0, split)}</span>
                <span style={{ fg: K9S.white }}>{pad(entry.slice(split), width - split)}</span>
              </>
            )
          })}
          <span>{" ".repeat(Math.max(0, inner() - 1 - width * 3))}</span>
        </>,
      ),
    )
    return [header, ...lines]
  }

  const visible = createMemo(() => (view().type === "services" ? serviceRows() : rows()).slice(top(), top() + bodyRows()))
  const signedOut = () => info() !== undefined && !info()!.account
  const signInHint = (): JSX.Element[] =>
    signedOut()
      ? [
          emptyLine(),
          sideLine(<span style={{ fg: K9S.orangeRed, bold: true }}>{pad("  Not signed in to AWS — every service shows 0.", inner())}</span>),
          emptyLine(),
          sideLine(<span style={{ fg: K9S.white }}>{pad("  L  or  :login   sign in with your AWS console account (opens the browser)", inner())}</span>),
          sideLine(<span style={{ fg: K9S.white }}>{pad("  :sso            sign in through IAM Identity Center (aws configure sso)", inner())}</span>),
          sideLine(<span style={{ fg: K9S.white }}>{pad("  :keys           paste an access key + secret (aws configure)", inner())}</span>),
          emptyLine(),
          sideLine(<span style={{ fg: K9S.slate }}>{pad("  No AWS account yet? Create one at https://portal.aws.amazon.com/billing/signup, then press L.", inner())}</span>),
        ]
      : []
  const padLines = (count: number) => Array.from({ length: Math.max(0, count) }, () => emptyLine())

  return (
    <box
      flexDirection="column"
      width={W()}
      height={dimensions().height}
      backgroundColor={K9S.bg}
      onMouseScroll={(event: { scroll?: { direction: string; delta?: number }; stopPropagation?: () => void }) => {
        const direction = event.scroll?.direction
        if (direction !== "up" && direction !== "down") return
        event.stopPropagation?.()
        move((direction === "up" ? -1 : 1) * Math.max(1, Math.round(event.scroll?.delta ?? 1)) * 3)
      }}
    >
      {Array.from({ length: HEADER_ROWS }, (_, index) => headerLine(index))}
      <Show when={prompt()}>{chromePromptBox({ width: W(), prompt: prompt()!, hint: prompt()!.kind === ":" ? suggest(prompt()!.value) : "" })}</Show>
      {topBorder()}
      <Switch>
        <Match when={view().type === "help"}>
          {helpBody()}
          {padLines(bodyRows() - helpBody().length)}
        </Match>
        <Match when={view().type === "services"}>
          {serviceHeader()}
          {visible().map((row, index) => serviceLine(row, index + top()))}
          {padLines(bodyRows() - visible().length - (signedOut() ? signInHint().length : 0))}
          {signInHint()}
        </Match>
        <Match when={true}>
          {columnHeader()}
          <Show when={!loadError() || table()} fallback={sideLine(<span style={{ fg: K9S.orangeRed }}>{pad(" " + (loadError() ?? ""), inner())}</span>)}>
            {visible().map((row, index) => rowLine(row, index + top()))}
          </Show>
          {padLines(bodyRows() - visible().length)}
        </Match>
      </Switch>
      {chromeBottomBorder({ width: W(), color: frameColor() })}
      {crumbsLine(store.stack.map((item) => (item.type === "table" ? item.service : item.type)))}
      {chromeFlashLine({ width: W(), flash: flash() })}
    </box>
  )
}
