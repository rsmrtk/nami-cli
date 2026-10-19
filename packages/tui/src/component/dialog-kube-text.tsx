import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { createResource, onMount, type JSX } from "solid-js"
import { type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { getScrollAcceleration } from "../util/scroll"
import { kubeNavBack } from "./kube-nav"

// Shared scrollable text pane for the `/k8s` browser's read-only output —
// logs, `describe`, and yaml all land here. Not DialogSelect: there is
// nothing to select, only to read and search with the terminal's own tools.
export function DialogKubeText(props: { title: string; fetch: () => Promise<string> }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let scroll: ScrollBoxRenderable | undefined

  const [text] = createResource(() => props.fetch().catch((err: unknown) => `(error: ${err instanceof Error ? err.message : String(err)})`))

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      kubeNavBack(dialog)
      return
    }
    if (evt.name === "up") return scroll?.scrollBy(-1)
    if (evt.name === "down") return scroll?.scrollBy(1)
    if (evt.name === "pageup" && scroll) return scroll.scrollBy(-scroll.height)
    if (evt.name === "pagedown" && scroll) return scroll.scrollBy(scroll.height)
    if (evt.name === "home" && scroll) return scroll.scrollTo(0)
    if (evt.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
  })

  const body = (): JSX.Element => {
    if (text.loading) return <text fg={theme.textMuted}>Loading…</text>
    const value = text() ?? ""
    if (!value.trim()) return <text fg={theme.textMuted}>(empty)</text>
    return <text fg={theme.text}>{value}</text>
  }

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.borderSubtle}
      title={` ${props.title} `}
      titleColor={theme.textMuted}
      bottomTitle=" ↑↓ scroll · esc back "
      bottomTitleAlignment="right"
      paddingLeft={1}
      paddingRight={1}
      flexGrow={1}
    >
      <scrollbox ref={(element: ScrollBoxRenderable) => (scroll = element)} flexGrow={1} scrollAcceleration={getScrollAcceleration()}>
        {body()}
      </scrollbox>
    </box>
  )
}
