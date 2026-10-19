import type { DialogContext } from "../ui/dialog"
import type { JSX } from "solid-js"

// A back-stack for the /k8s, /cloud and /integrations browsers — naki-cli's
// own behavior (esc steps back one level, only closes from the top). box's
// own `dialog.replace()` always discards history (it keeps at most one
// screen), so this keeps a second, parallel stack of the render closures
// each drill-down pushed, and "back" re-renders the previous one instead of
// calling dialog.clear().
//
// Module-level rather than per-component state: a fresh DialogSelect mounts
// on every drill, so local state would reset exactly when it needs to
// remember where it came from.
let historyStack: (() => JSX.Element)[] = []

export function kubeNavReset() {
  historyStack = []
}

export function kubeNavGo(dialog: DialogContext, render: () => JSX.Element) {
  historyStack.push(render)
  dialog.replace(render)
}

export function kubeNavBack(dialog: DialogContext) {
  historyStack.pop() // the screen being left
  const previous = historyStack.at(-1)
  if (previous) {
    dialog.replace(previous)
  } else {
    dialog.clear()
  }
}
