import type { JSX } from "solid-js"
import { nami } from "../logo"
import { K9S } from "./kube-k9s-model"

// The drawing half of the k9s-style browsers (/k8s, /cloud): the header with
// its hotkey menu and logo, the frame, the prompt, the crumbs and the flash
// line. Pure functions of their arguments — each browser keeps its own state
// and calls these from inside its JSX so they stay reactive.

export const HEADER_ROWS = 7
export const MENU_ROWS = 6

export type Hotkey = { key: string; desc: string }
export type Flash = { text: string; error?: boolean }
export type Prompt = { kind: ":" | "/"; value: string }

// The header logo is the same NAMI art as the home banner; the shadow strokes
// are drawn a shade darker than the solid blocks.
const LOGO = nami
const LOGO_SHADOW = "#7a5fa8"

function logoRuns(line: string): JSX.Element[] {
  return (line.match(/█+|[^█]+/g) ?? []).map((run) => <span style={{ fg: run.includes("█") ? K9S.orange : LOGO_SHADOW, bold: true }}>{run}</span>)
}

export function clip(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text
}

export function pad(text: string, width: number, right = false): string {
  const cut = clip(text, width)
  return right ? cut.padStart(width) : cut.padEnd(width)
}

// One of the seven header lines: info labels on the left, namespace-style
// number keys, the hotkey menu in columns of six, the logo when there is room.
export function headerLine(input: {
  index: number
  width: number
  labels: [string, string][]
  numbers: string[]
  numberWidth?: number
  menu: Hotkey[]
}): JSX.Element {
  const left = input.labels[input.index]
  const leftWidth = 42
  const numberWidth = input.numberWidth ?? 9
  const number = input.numbers.map((name, key) => ({ name, key })).slice(0, MENU_ROWS)[input.index]
  const columns = Math.max(1, Math.ceil(input.menu.length / MENU_ROWS))
  const keyWidth = Math.max(...input.menu.map((item) => item.key.length + 2), 6) + 1
  const descWidth = Math.max(...input.menu.map((item) => item.desc.length), 8) + 2
  const logoWidth = LOGO[0]!.length
  const showLogo = input.width >= leftWidth + 5 + numberWidth + columns * (keyWidth + descWidth) + logoWidth + 2
  const menuWidth = input.width - leftWidth - 5 - numberWidth - (showLogo ? logoWidth + 1 : 0)
  return (
    <text wrapMode="none">
      <span style={{ fg: K9S.orange }}>{pad(left?.[0] ?? "", 10)}</span>
      <span style={{ fg: K9S.white, bold: true }}>{pad(left?.[1] ?? "", leftWidth - 10)}</span>
      <span style={{ fg: K9S.fuchsia, bold: true }}>{pad(number ? `<${number.key}>` : "", 5)}</span>
      <span style={{ fg: K9S.white }}>{pad(number ? number.name : "", numberWidth)}</span>
      {Array.from({ length: columns }, (_, column) => input.menu[column * MENU_ROWS + input.index]).map((item) => (
        <>
          <span style={{ fg: K9S.dodger, bold: true }}>{pad(item ? `<${item.key}>` : "", keyWidth)}</span>
          <span style={{ fg: K9S.white }}>{pad(item?.desc ?? "", descWidth)}</span>
        </>
      ))}
      <span>{" ".repeat(Math.max(0, menuWidth - columns * (keyWidth + descWidth)))}</span>
      {showLogo ? logoRuns(LOGO[input.index] ?? "") : ""}
    </text>
  )
}

export function topBorder(input: { width: number; color: string; title: JSX.Element; titleLength: number }): JSX.Element {
  const space = Math.max(0, input.width - 2 - input.titleLength - 2)
  const leftDashes = Math.floor(space / 2)
  return (
    <text wrapMode="none">
      <span style={{ fg: input.color, bold: true }}>{"┌" + "─".repeat(leftDashes) + " "}</span>
      {input.title}
      <span style={{ fg: input.color, bold: true }}>{" " + "─".repeat(space - leftDashes) + "┐"}</span>
    </text>
  )
}

export function bottomBorder(input: { width: number; color: string }): JSX.Element {
  return (
    <text wrapMode="none">
      <span style={{ fg: input.color, bold: true }}>{"└" + "─".repeat(input.width - 2) + "┘"}</span>
    </text>
  )
}

export function sideLine(input: { color: string; children: JSX.Element; background?: string }): JSX.Element {
  return (
    <text wrapMode="none">
      <span style={{ fg: input.color, bold: true }}>│</span>
      <span style={{ bg: input.background }}>{input.children}</span>
      <span style={{ fg: input.color, bold: true }}>│</span>
    </text>
  )
}

// The frame title k9s draws: `name(scope)[count]`, then the active filter.
export function frameTitle(input: { name: string; scope: string; count: number; filter?: string }): JSX.Element {
  return (
    <>
      <span style={{ fg: K9S.aqua, bold: true }}>{input.name}(</span>
      <span style={{ fg: K9S.fuchsia, bold: true }}>{input.scope}</span>
      <span style={{ fg: K9S.aqua }}>)[</span>
      <span style={{ fg: K9S.papaya, bold: true }}>{input.count}</span>
      <span style={{ fg: K9S.aqua }}>]</span>
      <span style={{ fg: K9S.aqua }}>{input.filter ? ` </${input.filter}>` : ""}</span>
    </>
  )
}

export function frameTitleLength(input: { name: string; scope: string; count: number; filter?: string }): number {
  return `${input.name}(${input.scope})[${input.count}]`.length + (input.filter ? input.filter.length + 4 : 0)
}

export function promptBox(input: { width: number; prompt: Prompt; hint: string }): JSX.Element {
  const inner = input.width - 2
  const color = input.prompt.kind === ":" ? K9S.aqua : K9S.sea
  return (
    <box flexDirection="column" height={3}>
      <text wrapMode="none" fg={color}>
        {"┌" + "─".repeat(inner) + "┐"}
      </text>
      <text wrapMode="none">
        <span style={{ fg: color }}>│</span>
        <span style={{ fg: K9S.cadet }}>{input.prompt.kind === ":" ? " > " : " / "}</span>
        <span style={{ fg: K9S.cadet, bold: true }}>{input.prompt.value}</span>
        <span style={{ fg: K9S.dodger }}>{input.hint}</span>
        <span>{" ".repeat(Math.max(0, inner - 3 - input.prompt.value.length - input.hint.length))}</span>
        <span style={{ fg: color }}>│</span>
      </text>
      <text wrapMode="none" fg={color}>
        {"└" + "─".repeat(inner) + "┘"}
      </text>
    </box>
  )
}

export function crumbsLine(labels: string[]): JSX.Element {
  return (
    <text wrapMode="none">
      {labels.map((label, index) => (
        <>
          <span> </span>
          <span style={{ fg: K9S.black, bg: index === labels.length - 1 ? K9S.orange : K9S.aqua, bold: true }}>{` <${label}> `}</span>
        </>
      ))}
    </text>
  )
}

export function flashLine(input: { width: number; flash: Flash | undefined }): JSX.Element {
  if (!input.flash) return <text> </text>
  const left = Math.max(0, Math.floor((input.width - input.flash.text.length) / 2))
  return (
    <text wrapMode="none">
      <span>{" ".repeat(left)}</span>
      <span style={{ fg: input.flash.error ? K9S.orangeRed : K9S.navajo, bold: input.flash.error }}>{input.flash.text}</span>
    </text>
  )
}
