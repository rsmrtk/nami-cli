import { registerCustomTheme } from "@pierre/diffs"
import { RsmrtkTheme } from "./marked-theme"

let registered = false

export function registerRsmrtkTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Rsmrtk", () => Promise.resolve(RsmrtkTheme))
}
