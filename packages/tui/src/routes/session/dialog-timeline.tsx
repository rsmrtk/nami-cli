import { createMemo, onMount } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import type { TextPart } from "@rsmrtk/sdk/v2"
import { Locale } from "../../util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import { useRoute } from "../../context/route"
import type { PromptInfo } from "../../component/prompt/history"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const route = useRoute()

  onMount(() => {
    dialog.setSize("large")
  })

  // `fork()` never set session.parentID for its own child — that field is
  // for subagent sessions, a different tree entirely — so branch lineage
  // rides in metadata instead (see session.ts's fork()). No migration, no
  // generated SDK surface: sync.data.session is already the live, synced
  // list every session dialog already reads from.
  const forks = createMemo(() => sync.data.session.filter((s) => s.metadata?.forkedFrom === props.sessionID))

  const forkOption = (fork: (typeof sync.data.session)[number]): DialogSelectOption<string> => ({
    title: `⑂ ${fork.title}`,
    value: `fork:${fork.id}`,
    footer: Locale.time(fork.time.created),
    onSelect: (dialog) => {
      route.navigate({ sessionID: fork.id, type: "session" })
      dialog.clear()
    },
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const branches = forks()
    const result = [] as DialogSelectOption<string>[]

    // Forked with no specific turn picked ("Full session" in the fork
    // dialog) — nothing to anchor these to, so they lead the list.
    for (const fork of branches.filter((f) => !f.metadata?.forkedFromMessageID)) {
      result.push(forkOption(fork))
    }

    for (const message of messages) {
      if (message.role !== "user") continue
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      ) as TextPart
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      })
      for (const fork of branches.filter((f) => f.metadata?.forkedFromMessageID === message.id)) {
        result.push(forkOption(fork))
      }
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Timeline" options={options()} />
}
