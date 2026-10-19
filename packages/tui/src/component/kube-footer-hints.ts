// Shared footer hints for the /k8s, /cloud and /integrations browsers —
// naki-cli's own always-visible bar (`<↑↓> move  <enter> open  <r> refresh
// <esc> close`), which this port had been missing: only escape showed.
// DialogSelect already wires the keys themselves (arrows, enter, esc); this
// just makes them visible the way naki always did.
export const KUBE_MOVE_CLOSE_HINTS = [
  { title: "move", label: "↑↓" },
  { title: "close", label: "esc" },
]

export const KUBE_NAV_HINTS = [
  { title: "move", label: "↑↓" },
  { title: "open", label: "enter" },
  { title: "close", label: "esc" },
]

export const KUBE_NAV_REFRESH_HINTS = [...KUBE_NAV_HINTS, { title: "refresh", label: "ctrl+r" }]
