import { parse as parseYaml } from "yaml"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

// Ported from naki-cli (naki/evals/runner.py). A scenario is a prompt plus
// assertions about the resulting trace. Everything asserted is checkable from
// the trace itself — no judge model, no "does this sound right".

export type Expect = {
  called?: string[]
  not_called?: string[]
  called_before?: string[]
  mentions?: string[]
  mentions_any?: string[]
  forbids?: string[]
  denied?: string[]
  max_tool_calls?: number
  must_answer?: boolean
}

export type Scenario = {
  name: string
  prompt: string
  expect: Expect
  setup: string[]
  teardown: string[]
  requires: string[]
  why: string
}

export type Trace = { toolCalls: string[]; denied: string[]; answer: string }

// How far over its budget a run may go before the count itself is the
// finding. The same scenario has been seen at 5, 11, 15 and 19 calls, all
// correct; a red result for want of one call trains people to ignore the bench.
export const CAP_TOLERANCE = 1.5

// The scenarios were written against naki's tool names. nami's file tools are
// nami's, and its custom tools are kebab-case.
const ALIASES: Record<string, string> = { read_file: "read", write_file: "write", edit_file: "edit", http_fetch: "webfetch" }

export function canonical(name: string): string {
  return ALIASES[name] ?? name.replaceAll("_", "-")
}

export const SCENARIO_DIR = path.join(import.meta.dir, "scenarios")

export async function loadScenarios(directory = SCENARIO_DIR): Promise<Scenario[]> {
  const files = (await readdir(directory)).filter((f) => f.endsWith(".yaml")).sort()
  return Promise.all(
    files.map(async (file) => {
      const data: any = parseYaml(await readFile(path.join(directory, file), "utf-8")) ?? {}
      return {
        name: String(data.name ?? path.basename(file, ".yaml")),
        prompt: String(data.prompt ?? ""),
        expect: (data.expect ?? {}) as Expect,
        setup: (data.setup ?? []).map(String),
        teardown: (data.teardown ?? []).map(String),
        requires: (data.requires ?? []).map(String),
        why: String(data.why ?? ""),
      }
    }),
  )
}

/** Every assertion is evaluated, not short-circuited — one run should say everything wrong with it. */
export function check(scenario: Scenario, trace: Trace, notes: string[] = []): string[] {
  const expect = scenario.expect
  const failures: string[] = []
  const called = trace.toolCalls
  const answer = trace.answer.toLowerCase()

  for (const raw of expect.called ?? []) {
    const tool = canonical(raw)
    if (!called.includes(tool)) failures.push(`never called ${tool} (called: ${called.join(", ") || "nothing"})`)
  }
  for (const raw of expect.not_called ?? []) {
    const tool = canonical(raw)
    if (called.includes(tool)) failures.push(`called ${tool}, which this scenario forbids`)
  }

  const ordering = (expect.called_before ?? []).map(canonical)
  for (let i = 0; i + 1 < ordering.length; i++) {
    const [earlier, later] = [ordering[i]!, ordering[i + 1]!]
    if (called.includes(earlier) && called.includes(later) && called.indexOf(earlier) > called.indexOf(later)) {
      failures.push(`called ${later} before ${earlier}`)
    }
  }

  for (const phrase of expect.mentions ?? []) {
    if (!answer.includes(phrase.toLowerCase())) failures.push(`answer never mentions '${phrase}'`)
  }

  // For assertions about substance rather than vocabulary: "it explained the
  // constraint" is satisfied by several phrasings, and pinning one tests word
  // choice instead of behaviour.
  const alternatives = expect.mentions_any ?? []
  if (alternatives.length && !alternatives.some((p) => answer.includes(p.toLowerCase()))) {
    failures.push(`answer mentions none of ${JSON.stringify(alternatives)}`)
  }

  for (const phrase of expect.forbids ?? []) {
    if (answer.includes(phrase.toLowerCase())) failures.push(`answer contains forbidden phrase '${phrase}'`)
  }

  for (const raw of expect.denied ?? []) {
    const tool = canonical(raw)
    if (!trace.denied.includes(tool)) failures.push(`expected ${tool} to be refused, but it wasn't`)
  }

  if (expect.max_tool_calls !== undefined) {
    const cap = Number(expect.max_tool_calls)
    const used = called.length
    if (used > cap * CAP_TOLERANCE) {
      failures.push(`used ${used} tool calls against a budget of ${cap} — past the ${CAP_TOLERANCE}x tolerance, which is the runaway shape this cap exists for`)
    } else if (used > cap) {
      notes.push(`used ${used} tool calls, over the budget of ${cap} but within tolerance`)
    }
  }

  if (expect.must_answer && !trace.answer.trim()) failures.push("produced no final answer")
  return failures
}

/** Turns `nami run --format json` output into a trace. Tolerates non-JSON lines (logs). */
export function parseTrace(jsonLines: string): Trace {
  const trace: Trace = { toolCalls: [], denied: [], answer: "" }
  // Text between tool calls is narration; the answer is what the final message says.
  let messageID = ""
  let text = ""
  for (const line of jsonLines.split("\n")) {
    if (!line.startsWith("{")) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const part = event.part
    if (event.type === "tool_use" && part?.type === "tool") {
      const name = String(part.tool)
      trace.toolCalls.push(name)
      const detail = String(part.state?.error ?? part.state?.output ?? "").toLowerCase()
      if (part.state?.status === "error" && /reject|denied|not allowed|permission|forbidden/.test(detail)) trace.denied.push(name)
    } else if (event.type === "text" && part?.type === "text") {
      if (part.messageID !== messageID) {
        messageID = String(part.messageID)
        text = ""
      }
      text += String(part.text ?? "")
    }
  }
  trace.answer = text
  return trace
}
