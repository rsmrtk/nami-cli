// NAMI in the "ANSI Shadow" face: solid blocks with box-drawing edges as the shadow.
export const nami = [
  "███╗   ██╗ █████╗ ███╗   ███╗██╗",
  "████╗  ██║██╔══██╗████╗ ████║██║",
  "██╔██╗ ██║███████║██╔████╔██║██║",
  "██║╚██╗██║██╔══██║██║╚██╔╝██║██║",
  "██║ ╚████║██║  ██║██║ ╚═╝ ██║██║",
  "╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝",
]

// The home banner is drawn in two tones, "NA" muted and "MI" bright.
const split = 18
export const logo = {
  left: nami.map((line) => line.slice(0, split)),
  right: nami.map((line) => line.slice(split)),
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
