import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { runInteractive } from "../editor"
import { InstallationVersion } from "@rsmrtk/core/installation/version"
import { useDialog } from "../ui/dialog"
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
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useClipboard } from "../context/clipboard"
import {
  CLUSTER_SCOPED,
  K9S,
  NAMESPACED_KINDS,
  defaultSort,
  filterRows,
  isRightAligned,
  resolveKind,
  rowColor,
  sortRows,
  suggest,
  toTable,
  yamlSegments,
  type Row,
  type Sort,
  type Table,
} from "./kube-k9s-model"

// A copy of k9s inside box's /k8s: the same header, the same frame, the same
// command line, filter and hotkeys, drawn in k9s's own colours. Read-only on
// purpose — box's kube feature never mutates the cluster, so k9s's delete,
// kill, edit, shell, attach and port-forward are not offered (and not listed).

type View =
  | { type: "resources"; ns?: string; selKey?: string }
  | {
      type: "table"
      kind: string
      ns?: string // overrides the global namespace (drill-downs stay in the owner's namespace)
      node?: string // pods on one node
      prefix?: string // pods named after an owner
      owner?: string
      filter: string
      sort?: Sort
      selKey?: string
    }
  | { type: "containers"; ns: string; pod: string; selKey?: string; filter: string }
  | {
      type: "text"
      name: string // logs | describe | yaml
      title: string
      fetch: () => Promise<string>
      follow: boolean
      filter: string
    }
  | { type: "help" }

export function KubeK9s() {
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()
  const sdk = useSDK()
  const clipboard = useClipboard()
  const dimensions = useTerminalDimensions()

  onMount(() => dialog.setSize("full"))

  const [ns, setNsSignal] = createSignal("all")
  // kubeconfig context this screen talks to; undefined = kubectl's current one.
  const [cluster, setCluster] = createSignal<string>()
  const [favorites, setFavorites] = createSignal<string[]>(["all", "default"])
  const [store, setStore] = createStore<{ stack: View[] }>({ stack: [{ type: "table", kind: "contexts", filter: "" }] })
  const [info, setInfo] = createSignal<{ context: string; cluster: string; user: string; version: string }>()
  const [table, setTable] = createSignal<Table>()
  const [text, setText] = createSignal<string>()
  const [counts, setCounts] = createSignal<{ name: string; alias: string; count: number }[]>([])
  const [loadError, setLoadError] = createSignal<string>()
  const [flash, setFlash] = createSignal<Flash | undefined>({ text: "Pick a cluster — Enter opens its pods" })
  const [prompt, setPrompt] = createSignal<{ kind: ":" | "/"; value: string }>()
  const [selected, setSelected] = createSignal(0)
  const [top, setTop] = createSignal(0)
  const [scroll, setScroll] = createSignal(0)
  const [wrap, setWrap] = createSignal(false)

  const view = createMemo(() => store.stack.at(-1)!)
  const tableView = () => {
    const v = view()
    return v.type === "table" ? v : undefined
  }
  const effNs = () => {
    const v = view()
    return (v.type === "table" || v.type === "resources" || v.type === "containers" ? v.ns : undefined) ?? ns()
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const say = (message: string, error = false) => {
    if (flashTimer) clearTimeout(flashTimer)
    setFlash({ text: message, error })
    flashTimer = setTimeout(() => setFlash(undefined), error ? 6000 : 3000)
  }
  onCleanup(() => flashTimer && clearTimeout(flashTimer))

  const patchView = (patch: Record<string, unknown>) => {
    const index = store.stack.length - 1
    setStore("stack", index, patch as any)
  }

  const push = (next: View) => {
    setStore("stack", (stack) => [...stack, next])
    setSelected(0)
    setTop(0)
    setScroll(0)
    setTable(undefined)
    setText(undefined)
    setLoadError(undefined)
  }

  const back = () => {
    if (store.stack.length <= 1) return dialog.clear()
    setStore("stack", (stack) => stack.slice(0, -1))
    setSelected(0)
    setTop(0)
    setScroll(0)
    setTable(undefined)
    setText(undefined)
    setLoadError(undefined)
  }

  const useNamespace = (name: string) => {
    setNsSignal(name)
    setFavorites((list) => (list.includes(name) ? list : [...list, name].slice(0, 10)))
    // Drill-downs carry their own namespace; picking one from the keyboard
    // means "this namespace now", so drop the override.
    const v = view()
    if (v.type === "table" || v.type === "resources") patchView({ ns: undefined })
    say(name === "all" ? "Viewing all namespaces" : `Viewing namespace ${name}`)
  }

  // ---------------------------------------------------------------- data

  const withCluster = () => (cluster() ? { context: cluster()! } : {})

  createEffect(
    on(cluster, () => {
      setInfo(undefined)
      void sdk.client.experimental.kube.context(withCluster()).then(
        (result) => result.data && setInfo(result.data),
        () => undefined,
      )
    }),
  )

  const scopeFor = (kind: string, forNs: string | undefined) => {
    if (CLUSTER_SCOPED.has(kind)) return {}
    if (!forNs || forNs === "all") return { allNamespaces: "true" as const }
    return { namespace: forNs }
  }

  const fetchTable = async (v: View, key: string): Promise<void> => {
    try {
      if (v.type === "resources") {
        const forNs = v.ns ?? ns()
        const rows = await Promise.all(
          NAMESPACED_KINDS.map(async (kind) => {
            const result = await sdk.client.experimental.kube
              .table({ kind: kind.kind, ...scopeFor(kind.kind, forNs), ...withCluster() })
              .then((r) => r.data?.rows.length ?? 0, () => 0)
            return { name: kind.kind, alias: kind.aliases[0]!, count: result }
          }),
        )
        if (key !== loadKey()) return
        setCounts(rows)
        setLoadError(undefined)
        return
      }
      if (v.type === "containers") {
        const list = await sdk.client.experimental.kube.containers({ namespace: v.ns, pod: v.pod, ...withCluster() })
        if (key !== loadKey()) return
        if (!list.data) throw new Error(String((list.error as any)?.message ?? "could not list containers"))
        setTable({
          columns: ["NAME", "IMAGE"],
          rows: list.data.map((item) => ({ name: item.name, cells: [item.name, item.image] })),
        })
        setLoadError(undefined)
        return
      }
      if (v.type === "table" && v.kind === "contexts") {
        const list = await sdk.client.experimental.kube.contexts()
        if (key !== loadKey()) return
        if (!list.data) throw new Error(String((list.error as any)?.message ?? "could not read kubeconfig"))
        setTable({
          columns: ["NAME", "CLUSTER", "USER", "NAMESPACE", "CURRENT"],
          rows: list.data.map((item) => ({
            name: item.name,
            cells: [item.name, item.cluster, item.user, item.namespace, item.current ? "*" : ""],
          })),
        })
        // First visit: put the cursor on the cluster kubectl already uses.
        const current = list.data.find((item) => item.current)
        if (current && !v.selKey) patchView({ selKey: `/${current.name}` })
        setLoadError(undefined)
        return
      }
      if (v.type === "table") {
        const forNs = v.ns ?? ns()
        const result = await sdk.client.experimental.kube.table({
          kind: v.kind,
          ...(v.node ? { node: v.node } : scopeFor(v.kind, forNs)),
          ...withCluster(),
        })
        if (key !== loadKey()) return
        if (!result.data) throw new Error(String((result.error as any)?.message ?? "kubectl failed"))
        let next = toTable(result.data)
        if (v.prefix) next = { ...next, rows: next.rows.filter((row) => row.name.startsWith(`${v.prefix}-`)) }
        setTable(next)
        setLoadError(undefined)
        return
      }
      if (v.type === "text") {
        const body = await v.fetch().catch((err: unknown) => `(error: ${err instanceof Error ? err.message : String(err)})`)
        if (key !== loadKey()) return
        const first = text() === undefined
        setText(body)
        if (v.follow && first) setScroll(Number.MAX_SAFE_INTEGER)
        return
      }
    } catch (error) {
      if (key !== loadKey()) return
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      say(message, true)
    }
  }

  // One key per (view, namespace) so a slow response for the screen we have
  // already left can never paint over the one we are on.
  const loadKey = createMemo(() => {
    const v = view()
    const parts: unknown[] = [store.stack.length, v.type, effNs(), cluster()]
    if (v.type === "table") parts.push(v.kind, v.node, v.prefix)
    if (v.type === "containers") parts.push(v.pod)
    if (v.type === "text") parts.push(v.name, v.title)
    return JSON.stringify(parts)
  })

  createEffect(
    on(loadKey, (key) => {
      void fetchTable(view(), key)
    }),
  )

  // k9s redraws every couple of seconds; logs follow the same beat.
  // The resource list costs fourteen kubectl calls, so it only reloads on
  // entry, on a namespace change or on ctrl-r.
  const timer = setInterval(() => {
    if (view().type !== "resources") void fetchTable(view(), loadKey())
  }, 3000)
  onCleanup(() => clearInterval(timer))

  // ---------------------------------------------------------------- derived

  const sort = createMemo<Sort | undefined>(() => {
    const t = table()
    const v = tableView()
    if (!t) return undefined
    return v?.sort ?? defaultSort(t.columns)
  })

  const rows = createMemo<Row[]>(() => {
    const t = table()
    const v = view()
    if (!t) return []
    const sorted = v.type === "table" ? sortRows(t, sort()!) : t.rows
    return filterRows(sorted, v.type === "table" || v.type === "containers" ? v.filter : "")
  })

  const pickerRows = createMemo<Row[]>(() =>
    counts().map((item) => ({ name: item.name, cells: [item.name, item.alias, String(item.count)] })),
  )

  // Data rows that fit between the frame's column header and its bottom edge.
  // Views without a column header (text, help) get that one line back.
  const bodyRows = () => {
    const v = view().type
    const base = dimensions().height - 12 - (prompt() ? 3 : 0)
    return Math.max(1, v === "text" || v === "help" ? base + 1 : base)
  }

  const lines = createMemo(() => {
    const body = text() ?? ""
    let all = body.replace(/\n+$/, "").split("\n")
    const v = view()
    if (v.type === "text" && v.filter) {
      const needle = v.filter.toLowerCase()
      all = all.filter((line) => line.toLowerCase().includes(needle))
    }
    if (!wrap()) return all
    // Soft wrap, as k9s's `w`: long log lines continue on the next row.
    const width = Math.max(10, inner() - 2)
    return all.flatMap((line) => {
      if (line.length <= width) return [line]
      const parts: string[] = []
      for (let i = 0; i < line.length; i += width) parts.push(line.slice(i, i + width))
      return parts
    })
  })

  const listLength = () => {
    const v = view()
    if (v.type === "resources") return pickerRows().length
    if (v.type === "text") return lines().length
    return rows().length
  }

  const clampSelection = (index: number) => {
    const max = Math.max(0, listLength() - 1)
    const next = Math.min(max, Math.max(0, index))
    setSelected(next)
    const visible = bodyRows()
    if (next < top()) setTop(next)
    else if (next >= top() + visible) setTop(next - visible + 1)
    const current = currentRow()
    if (current) patchView({ selKey: `${current.ns ?? ""}/${current.name}` })
  }

  const currentRow = (): Row | undefined => {
    const v = view()
    if (v.type === "resources") return pickerRows()[selected()]
    if (v.type === "table" || v.type === "containers") return rows()[selected()]
    return undefined
  }

  // After a refresh the cursor stays on the same object, not the same index.
  createEffect(
    on([rows, pickerRows], () => {
      const v = view()
      if (v.type !== "table" && v.type !== "containers") return
      const key = v.selKey
      if (!key) return
      const list = rows()
      const found = list.findIndex((row) => `${row.ns ?? ""}/${row.name}` === key)
      if (found >= 0 && found !== selected()) setSelected(found)
      else if (found < 0 && selected() >= list.length) setSelected(Math.max(0, list.length - 1))
    }),
  )

  // ---------------------------------------------------------------- actions

  const rowNs = (row: Row) => row.ns ?? (effNs() === "all" ? undefined : effNs())

  const openText = (name: string, title: string, fetch: () => Promise<string>, follow = false) =>
    push({ type: "text", name, title, fetch, follow, filter: "" })

  const describe = (kind: string, row: Row) => {
    const forNs = rowNs(row)
    openText("describe", `describe(${forNs ? forNs + "/" : ""}${row.name})`, () =>
      sdk.client.experimental.kube
        .describe({ kind, name: row.name, ...(forNs ? { namespace: forNs } : {}), ...withCluster() })
        .then((r) => (r.data?.text ?? String((r.error as any)?.message ?? ""))),
    )
  }

  // Opens the live object in $KUBE_EDITOR / $VISUAL / $EDITOR (nvim) via
  // `kubectl edit`: :wq applies the change, :q! discards it. kubectl itself
  // validates and re-opens on error, so nothing is applied half-way.
  const yaml = (kind: string, row: Row) => {
    if (kind === "secrets") return say("Secret values are never shown — use describe for key names and sizes.", true)
    const forNs = rowNs(row)
    const editor = process.env.KUBE_EDITOR || process.env.VISUAL || process.env.EDITOR || "nvim"
    void runInteractive({
      renderer,
      command: "kubectl",
      args: [...(cluster() ? [`--context=${cluster()}`] : []), "edit", kind, row.name, ...(forNs ? ["-n", forNs] : [])],
      env: { KUBE_EDITOR: editor },
    }).then(
      (code) => {
        if (code === 0) say(`${kind}/${row.name}: editor closed — changes (if any) applied`)
        else say(`kubectl edit exited with code ${code}`, true)
      },
      (error) => say(String(error?.message ?? error), true),
    )
  }

  const logs = (forNs: string, pod: string, container: string | undefined, previous: boolean) =>
    openText(
      previous ? "logs previous" : "logs",
      `logs(${forNs}/${pod}${container ? ":" + container : ""})`,
      () =>
        sdk.client.experimental.kube
          .podLogs({ namespace: forNs, pod, tail: "400", ...(container ? { container } : {}), ...(previous ? { previous: "true" } : {}), ...withCluster() } as any)
          .then((r) => (r.data?.text ?? String((r.error as any)?.message ?? ""))),
      !previous,
    )

  const podLogs = async (row: Row, previous: boolean) => {
    const forNs = rowNs(row)
    if (!forNs) return say("Select a pod in a namespace first.", true)
    const list = await sdk.client.experimental.kube.containers({ namespace: forNs, pod: row.name, ...withCluster() }).then((r) => r.data ?? [], () => [])
    if (list.length > 1) {
      say("This pod has several containers — pick one.")
      return push({ type: "containers", ns: forNs, pod: row.name, filter: "" })
    }
    logs(forNs, row.name, undefined, previous)
  }

  // Points the screen at one cluster. Namespace goes back to "all": a namespace
  // from the previous cluster means nothing here.
  const useCluster = (name: string) => {
    setCluster(name)
    setNsSignal("all")
    say(`Cluster ${name}`)
  }

  const enter = () => {
    const v = view()
    const row = currentRow()
    if (!row) return
    if (v.type === "table" && v.kind === "contexts") {
      useCluster(row.name)
      return push({ type: "table", kind: "pods", filter: "" })
    }
    if (v.type === "resources") return openKind(row.name)
    if (v.type === "containers") return logs(v.ns, v.pod, row.name, false)
    if (v.type !== "table") return
    const def = resolveKind(v.kind)
    if (v.kind === "namespaces") {
      useNamespace(row.name)
      return push({ type: "table", kind: "pods", filter: "" })
    }
    if (v.kind === "nodes") return push({ type: "table", kind: "pods", node: row.name, ns: "all", owner: row.name, filter: "" })
    if (v.kind === "pods") {
      const forNs = rowNs(row)
      if (!forNs) return
      return push({ type: "containers", ns: forNs, pod: row.name, filter: "" })
    }
    if (def.hasPods) return push({ type: "table", kind: "pods", ns: rowNs(row) ?? "all", prefix: row.name, owner: row.name, filter: "" })
    if (v.kind === "events") return
    if (v.kind === "secrets") return describe(v.kind, row)
    return yaml(v.kind, row)
  }

  const openKind = (token: string, argument?: string) => {
    const def = resolveKind(token)
    if (argument?.startsWith("/")) {
      push({ type: "table", kind: def.kind, filter: argument.slice(1) })
    } else {
      if (argument) useNamespace(argument)
      push({ type: "table", kind: def.kind, filter: "" })
    }
    say(`Viewing v1/${def.kind}${CLUSTER_SCOPED.has(def.kind) ? "" : ` in namespace ${effNs()}`}`)
  }

  const runCommand = (value: string) => {
    const [head, ...rest] = value.trim().split(/\s+/)
    if (!head) return
    const word = head.toLowerCase()
    if (["q", "quit", "q!", "exit"].includes(word)) return dialog.clear()
    if (["help", "?"].includes(word)) return push({ type: "help" })
    if (["alias", "aliases", "a"].includes(word)) return push({ type: "resources" })
    if (["xray", "pulse", "popeye", "pf", "portforward", "pu", "dir"].includes(word))
      return say(`:${word} is not available in nami's /k8s browser.`, true)
    if (resolveKind(word).kind === "contexts") {
      // `:ctx` lists the clusters, `:ctx name` jumps straight into one.
      if (!rest[0]) return push({ type: "table", kind: "contexts", filter: "" })
      useCluster(rest[0])
      return push({ type: "table", kind: "pods", filter: "" })
    }
    openKind(word, rest[0])
  }

  const toggleSort = (column: string) => {
    const v = tableView()
    const t = table()
    if (!v || !t || !t.columns.includes(column)) return say(`No ${column} column here.`, true)
    const current = sort()
    patchView({ sort: { column, desc: current?.column === column ? !current.desc : false } })
  }

  const copy = (value: string, label: string) => {
    if (!clipboard.write) return say("Clipboard not available.", true)
    void clipboard.write(value).then(
      () => say(`${label} copied to clipboard`),
      (error) => toast.error(error),
    )
  }

  const textStart = () => Math.max(0, Math.min(scroll(), Math.max(0, lines().length - bodyRows())))

  const move = (delta: number) => {
    const v = view()
    if (v.type === "text") return setScroll(Math.max(0, textStart() + delta))
    clampSelection(selected() + delta)
  }

  const jump = (target: "top" | "bottom") => {
    const v = view()
    if (v.type === "text") return setScroll(target === "top" ? 0 : Number.MAX_SAFE_INTEGER)
    clampSelection(target === "top" ? 0 : listLength() - 1)
  }

  // ---------------------------------------------------------------- keys

  // Escape goes through the keymap, not useKeyboard: the dialog's own escape
  // binding closes everything and would win otherwise. Esc steps back one
  // level — first dropping a filter or the prompt, like k9s.
  useBindings(() => ({
    bindings: [
      {
        key: "escape",
        desc: "Back",
        group: "Dialog",
        cmd: () => {
          if (prompt()) return setPrompt(undefined)
          const v = view()
          if ((v.type === "table" || v.type === "containers" || v.type === "text") && v.filter) return patchView({ filter: "" })
          back()
        },
      },
    ],
  }))

  useKeyboard((evt) => {
    const handled = () => {
      evt.preventDefault()
      evt.stopPropagation()
    }
    const p = prompt()
    if (p) {
      handled()
      if (evt.name === "return") {
        setPrompt(undefined)
        // Enter runs exactly what is in the prompt; Tab is what completes it.
        if (p.kind === ":") return runCommand(p.value)
        const v = view()
        if (v.type === "table" || v.type === "containers" || v.type === "text") patchView({ filter: p.value })
        setSelected(0)
        setTop(0)
        return
      }
      if (evt.name === "backspace") return setPrompt({ kind: p.kind, value: p.value.slice(0, -1) })
      if (evt.ctrl && evt.name === "u") return setPrompt({ kind: p.kind, value: "" })
      if (evt.name === "tab" || evt.name === "right") {
        if (p.kind === ":") return setPrompt({ kind: ":", value: p.value + suggest(p.value) })
        return
      }
      const seq = evt.sequence
      if (!evt.ctrl && !evt.meta && seq && seq.length === 1 && seq >= " ") {
        const value = p.value + seq
        setPrompt({ kind: p.kind, value })
        // Filter is live, like k9s: rows narrow as you type.
        if (p.kind === "/") {
          const v = view()
          if (v.type === "table" || v.type === "containers" || v.type === "text") patchView({ filter: value })
          setSelected(0)
          setTop(0)
        }
      }
      return
    }

    handled()
    const v = view()
    const row = currentRow()
    const name = evt.name
    const seq = evt.sequence

    if (evt.ctrl && name === "c") return dialog.clear()
    if (seq === ":") return setPrompt({ kind: ":", value: "" })
    if (seq === "/" && (v.type === "table" || v.type === "containers" || v.type === "text")) return setPrompt({ kind: "/", value: v.filter })
    if (seq === "?") return v.type === "help" ? back() : push({ type: "help" })
    if (evt.ctrl && name === "a") return push({ type: "resources" })
    if (evt.ctrl && name === "r") return void fetchTable(v, loadKey())
    if (name === "q" && !evt.ctrl) return back()

    // Namespace hotkeys: 0 = all, 1..9 = favourites, as k9s.
    if (seq && /^[0-9]$/.test(seq) && v.type !== "text" && v.type !== "help") {
      const list = favorites()
      const chosen = list[Number(seq)]
      if (chosen) useNamespace(chosen)
      return
    }

    if (name === "up" || seq === "k") return move(-1)
    if (name === "down" || seq === "j") return move(1)
    if (name === "pageup" || (evt.ctrl && name === "b")) return move(-bodyRows())
    if (name === "pagedown" || (evt.ctrl && name === "f")) return move(bodyRows())
    if (evt.ctrl && name === "d" && v.type === "text") return move(Math.floor(bodyRows() / 2))
    if (evt.ctrl && name === "u" && v.type === "text") return move(-Math.floor(bodyRows() / 2))
    if (seq === "w" && v.type === "text") {
      setWrap((value) => !value)
      return say(wrap() ? "Wrap on" : "Wrap off")
    }
    if (name === "home" || seq === "g") return jump("top")
    if (name === "end" || seq === "G") return jump("bottom")
    if (name === "return") return enter()

    if (v.type === "table" || v.type === "containers") {
      if (seq === "N") return toggleSort("NAME")
      if (seq === "A") return toggleSort("AGE")
      if (seq === "S") return toggleSort("STATUS")
      if (seq === "P") return toggleSort("NAMESPACE")
      if (seq === "c" && row) return copy(row.name, "Name")
      if (seq === "n" && row?.ns) return copy(row.ns, "Namespace")
    }
    if (v.type === "table" && v.kind !== "contexts") {
      if (seq === "d" && row) return describe(v.kind, row)
      if (seq === "y" && row) return yaml(v.kind, row)
      if (seq === "l" && row && v.kind === "pods") return void podLogs(row, false)
      if (seq === "p" && row && v.kind === "pods") return void podLogs(row, true)
      if (seq === "u" && row && v.kind === "namespaces") return useNamespace(row.name)
      if (seq === "o" && row && v.kind === "pods") return say("Show node is not available in this build.", true)
    }
    if (v.type === "containers") {
      if (seq === "l" && row) return logs(v.ns, v.pod, row.name, false)
      if (seq === "p" && row) return logs(v.ns, v.pod, row.name, true)
    }
    if (v.type === "text" && seq === "c") return copy(lines().join("\n"), "Output")
    if (v.type === "text" && seq === " ") return move(bodyRows())
  })

  // ---------------------------------------------------------------- menu

  const menu = createMemo<Hotkey[]>(() => {
    const v = view()
    const common: Hotkey[] = [{ key: "?", desc: "Help" }, { key: "ctrl-a", desc: "Aliases" }, { key: "ctrl-r", desc: "Refresh" }]
    if (v.type === "help") return [{ key: "esc", desc: "Back" }]
    if (v.type === "text") return [{ key: "esc", desc: "Back" }, { key: "/", desc: "Filter" }, { key: "c", desc: "Copy" }, { key: "w", desc: "Wrap" }, { key: "g", desc: "Top" }, { key: "shift-g", desc: "Bottom" }]
    if (v.type === "resources") return [{ key: "enter", desc: "Open" }, ...common]
    if (v.type === "table" && v.kind === "contexts") return [{ key: "enter", desc: "Use cluster" }, ...common, { key: "c", desc: "Copy" }]
    const items: Hotkey[] = [...common, { key: "c", desc: "Copy" }, { key: "d", desc: "Describe" }]
    if (v.type === "containers") items.push({ key: "l", desc: "Logs" }, { key: "p", desc: "Logs Previous" })
    else {
      if (v.kind !== "secrets") items.push({ key: "y", desc: "Edit YAML" })
      if (v.kind === "pods") items.push({ key: "l", desc: "Logs" }, { key: "p", desc: "Logs Previous" })
      if (v.kind === "namespaces") items.push({ key: "u", desc: "Use" })
      items.push({ key: "shift-a", desc: "Sort Age" }, { key: "shift-n", desc: "Sort Name" }, { key: "shift-s", desc: "Sort Status" })
    }
    return items.sort((a, b) => a.key.localeCompare(b.key))
  })

  // ---------------------------------------------------------------- render

  const bold = TextAttributes.BOLD
  const W = () => dimensions().width
  const inner = () => W() - 2

  const headerLine = (index: number): JSX.Element => {
    const i = info()
    return chromeHeaderLine({
      index,
      width: W(),
      menu: menu(),
      numbers: favorites(),
      labels: [
        ["Context:", `${i?.context ?? "…"} [RO]`],
        ["Cluster:", i?.cluster ?? ""],
        ["User:", i?.user ?? ""],
        ["Nami Rev:", String(InstallationVersion)],
        ["K8s Rev:", i?.version ?? ""],
      ],
    })
  }

  // What the frame says about the screen: `pods(all)[13]` for a table, the
  // path for logs/yaml, plain "Help".
  const titleParts = () => {
    const v = view()
    if (v.type === "resources") return { name: "resources", scope: effNs(), count: pickerRows().length }
    if (v.type === "table") return { name: v.kind, scope: CLUSTER_SCOPED.has(v.kind) ? "all" : effNs(), count: rows().length, filter: v.filter }
    if (v.type === "containers") return { name: "containers", scope: `${v.ns}/${v.pod}`, count: rows().length, filter: v.filter }
    return undefined
  }

  const frameTitle = (): JSX.Element => {
    const v = view()
    const parts = titleParts()
    if (parts) return chromeFrameTitle(parts)
    if (v.type === "text")
      return (
        <>
          <span style={{ fg: K9S.aqua, bold: true }}>{v.title}</span>
          <span style={{ fg: K9S.aqua }}>{v.filter ? ` </${v.filter}>` : ""}</span>
        </>
      )
    return <span style={{ fg: K9S.aqua, bold: true }}>Help</span>
  }

  const titleLength = () => {
    const v = view()
    const parts = titleParts()
    if (parts) return frameTitleLength(parts)
    if (v.type === "text") return v.title.length + (v.filter ? v.filter.length + 4 : 0)
    return 4
  }

  const frameColor = () => (prompt() ? K9S.dodger : K9S.sky)

  const topBorder = (): JSX.Element => chromeTopBorder({ width: W(), color: frameColor(), title: frameTitle(), titleLength: titleLength() })

  const bottomBorder = (): JSX.Element => chromeBottomBorder({ width: W(), color: frameColor() })

  // Column layout for the current table: widest cell per column, squeezed
  // from the widest down until the line fits inside the frame.
  const layout = createMemo(() => {
    const t = table()
    const v = view()
    if (!t || v.type === "resources" || v.type === "text" || v.type === "help") return undefined
    const marker = sort()?.column
    const widths = t.columns.map((column, index) => {
      const cells = rows().map((row) => (row.cells[index] ?? "").length)
      return Math.max(column.length + (column === marker ? 1 : 0), ...cells) + 2
    })
    const budget = inner() - 1
    let total = widths.reduce((a, b) => a + b, 0)
    while (total > budget) {
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
    return (
      <text wrapMode="none">
        <span style={{ fg: frameColor(), bold: true }}>│</span>
        <span> </span>
        {t.columns.map((column, index) => {
          const active = column === s?.column
          const arrow = active ? (s!.desc ? "↓" : "↑") : ""
          const room = widths[index]! - column.length - arrow.length
          const right = isRightAligned(column)
          return (
            <>
              <span>{right ? " ".repeat(Math.max(0, room - 1)) : ""}</span>
              <span style={{ fg: active ? K9S.sky : K9S.white }}>{column}</span>
              <span style={{ fg: K9S.aqua, bold: true }}>{arrow}</span>
              <span>{right ? " " : " ".repeat(Math.max(0, room))}</span>
            </>
          )
        })}
        <span>{" ".repeat(Math.max(0, inner() - 1 - widths.reduce((a, b) => a + b, 0)))}</span>
        <span style={{ fg: frameColor(), bold: true }}>│</span>
      </text>
    )
  }

  const sideLine = (children: JSX.Element, background?: string): JSX.Element => chromeSideLine({ color: frameColor(), children, background })

  const rowLine = (row: Row, index: number): JSX.Element => {
    const t = table()!
    const widths = layout()!
    const active = index === selected()
    const color = active ? K9S.black : rowColor(t, row)
    const bg = active ? K9S.sky : undefined
    const used = widths.reduce((a, b) => a + b, 0)
    return (
      <text wrapMode="none">
        <span style={{ fg: frameColor(), bold: true }}>│</span>
        <span style={{ fg: color, bg, bold: active }}>
          {" " + t.columns.map((column, c) => (isRightAligned(column) ? pad(row.cells[c] ?? "", widths[c]! - 1, true) + " " : pad(row.cells[c] ?? "", widths[c]!))).join("") + " ".repeat(Math.max(0, inner() - 1 - used))}
        </span>
        <span style={{ fg: frameColor(), bold: true }}>│</span>
      </text>
    )
  }

  const emptyLine = (): JSX.Element => sideLine(<span>{" ".repeat(inner())}</span>)

  const pickerLine = (row: Row, index: number): JSX.Element => {
    const active = index === selected()
    const count = Number(row.cells[2])
    // Empty kinds are grey, kinds that have objects are k9s blue.
    const color = active ? K9S.black : count > 0 ? K9S.sky : K9S.slate
    const text = " " + pad(row.cells[0]!, 28) + pad(row.cells[1]!, 10) + pad(String(count), 8, true)
    return sideLine(<span style={{ fg: color, bg: active ? K9S.sky : undefined, bold: active }}>{pad(text, inner())}</span>)
  }

  const pickerHeader = (): JSX.Element =>
    sideLine(<span style={{ fg: K9S.white }}>{pad(" " + pad("NAME", 28) + pad("ALIAS", 10) + pad("COUNT", 8, true), inner())}</span>)

  const textLine = (line: string): JSX.Element => {
    const v = view()
    if (v.type !== "text" || v.name !== "yaml") return sideLine(<span style={{ fg: K9S.sky }}>{pad(" " + line, inner())}</span>)
    // Clip across segments so a long line never pushes the frame's edge out.
    let room = inner() - 1
    const parts = yamlSegments(line).flatMap((segment) => {
      if (room <= 0) return []
      const text = segment.text.length > room ? segment.text.slice(0, room) : segment.text
      room -= text.length
      return [{ text, fg: segment.fg }]
    })
    return sideLine(
      <>
        <span> </span>
        {parts.map((part) => (
          <span style={{ fg: part.fg }}>{part.text}</span>
        ))}
        <span>{" ".repeat(Math.max(0, room))}</span>
      </>,
    )
  }

  const helpColumns = (): string[][] => {
    const resource = [
      "<0>        all",
      "<1>        favourite namespace",
      "<c>        Copy name",
      "<n>        Copy namespace",
      "<d>        Describe",
      "<y>        Edit YAML in vim (kubectl edit)",
      "<l>        Logs",
      "<p>        Logs Previous",
      "<u>        Use namespace",
      "<ctrl-r>   Refresh",
      "<shift-a>  Sort Age",
      "<shift-n>  Sort Name",
      "<shift-p>  Sort Namespace",
      "<shift-s>  Sort Status",
    ]
    const general = [
      "<ctrl-a>   Aliases",
      "<q>        Back",
      "<esc>      Back/Clear",
      "<:ctx>     Pick cluster (:ctx name)",
      "<:cmd>     Command mode",
      "</term>    Filter mode",
      "<?>        Help",
      "<:q>       Quit",
      "<enter>    View / drill down",
      "<tab>      Complete command",
    ]
    const navigation = ["<j>        Down", "<k>        Up", "<g>        Goto Top", "<shift-g>  Goto Bottom", "<ctrl-f>   Page Down", "<ctrl-b>   Page Up"]
    return [resource, general, navigation]
  }

  const helpBody = (): JSX.Element[] => {
    const columns = helpColumns()
    const heads = ["RESOURCE", "GENERAL", "NAVIGATION"]
    const width = Math.floor((inner() - 2) / 3)
    const count = Math.max(...columns.map((column) => column.length))
    const out: JSX.Element[] = [sideLine(<span style={{ fg: K9S.sky }}>{" " + heads.map((head) => pad(head, width)).join("") + " ".repeat(Math.max(0, inner() - 1 - width * 3))}</span>)]
    for (let line = 0; line < count; line++) {
      out.push(
        sideLine(
          <>
            <span> </span>
            {columns.map((column) => {
              const entry = column[line] ?? ""
              const split = entry.indexOf(">") + 1
              return (
                <>
                  <span style={{ fg: K9S.dodger, bold: true }}>{entry.slice(0, split).padEnd(split)}</span>
                  <span style={{ fg: K9S.white }}>{pad(entry.slice(split), width - split)}</span>
                </>
              )
            })}
            <span>{" ".repeat(Math.max(0, inner() - 1 - width * 3))}</span>
          </>,
        ),
      )
    }
    return out
  }

  const promptBox = (): JSX.Element => {
    const p = prompt()!
    return chromePromptBox({ width: W(), prompt: p, hint: p.kind === ":" ? suggest(p.value) : "" })
  }

  const visibleRows = createMemo(() => {
    const v = view()
    const start = top()
    const size = bodyRows()
    if (v.type === "resources") return pickerRows().slice(start, start + size)
    if (v.type === "table" || v.type === "containers") return rows().slice(start, start + size)
    return []
  })

  const textWindow = createMemo(() => {
    const start = textStart()
    return lines().slice(start, start + bodyRows())
  })

  const crumbs = (): JSX.Element =>
    crumbsLine(
      store.stack.map((item) =>
        item.type === "table" ? item.kind : item.type === "containers" ? "containers" : item.type === "text" ? item.name : item.type,
      ),
    )

  const flashLine = (): JSX.Element => chromeFlashLine({ width: W(), flash: flash() })

  const padLines = (count: number): JSX.Element[] => Array.from({ length: Math.max(0, count) }, () => emptyLine())

  return (
    <box
      flexDirection="column"
      width={W()}
      height={dimensions().height}
      backgroundColor={K9S.bg}
      onMouseScroll={(event: any) => {
        // Wheel / trackpad scrolls whatever is on screen: the cursor in a
        // table, the text in logs, yaml and describe.
        const direction = event.scroll?.direction
        if (direction !== "up" && direction !== "down") return
        event.stopPropagation?.()
        const step = Math.max(1, Math.round(event.scroll?.delta ?? 1)) * 3
        move(direction === "up" ? -step : step)
      }}
    >
      {Array.from({ length: HEADER_ROWS }, (_, index) => headerLine(index))}
      <Show when={prompt()}>{promptBox()}</Show>
      {topBorder()}
      <Switch>
        <Match when={view().type === "help"}>
          {helpBody()}
          {padLines(bodyRows() - helpBody().length)}
        </Match>
        <Match when={view().type === "text"}>
          {textWindow().map((line) => textLine(line))}
          {padLines(bodyRows() - textWindow().length)}
        </Match>
        <Match when={view().type === "resources"}>
          {pickerHeader()}
          {visibleRows().map((row, index) => pickerLine(row, index + top()))}
          {padLines(bodyRows() - visibleRows().length)}
        </Match>
        <Match when={true}>
          {columnHeader()}
          <Show
            when={!loadError() || table()}
            fallback={sideLine(<span style={{ fg: K9S.orangeRed }}>{pad(" " + (loadError() ?? ""), inner())}</span>)}
          >
            {visibleRows().map((row, index) => rowLine(row, index + top()))}
          </Show>
          {padLines(bodyRows() - visibleRows().length)}
        </Match>
      </Switch>
      {bottomBorder()}
      {crumbs()}
      {flashLine()}
    </box>
  )
}
