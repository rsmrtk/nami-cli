import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { logo } from "../logo"

// The banner wears the same two colours as the /k8s and /cloud screens: lilac "NA", light-blue "MI".
const LILAC = "#cba6f7"
const BLUE = "#89b4fa"

export function Logo() {
  const { theme } = useTheme()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      // The shadow strokes of the NAMI face sit back from the solid blocks.
      if ("╗╔╝╚═║".includes(char)) {
        return (
          <text fg={tint(theme.background, fg, 0.45)} selectable={false}>
            {char}
          </text>
        )
      }
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  return (
    <box>
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, RGBA.fromHex(LILAC), true)}</box>
            <box flexDirection="row">{renderLine(logo.right[index()], RGBA.fromHex(BLUE), true)}</box>
          </box>
        )}
      </For>
    </box>
  )
}
