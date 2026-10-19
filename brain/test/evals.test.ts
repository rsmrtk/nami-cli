import { describe, expect, test } from "bun:test"
import { canonical, check, CAP_TOLERANCE, loadScenarios, parseTrace, type Scenario, type Trace } from "../evals/runner"

// Ported from naki-cli tests/test_evals.py: the bench's own scoring is code,
// so it gets tested without running a model.

const scenario = (expectation: Scenario["expect"]): Scenario => ({
  name: "s", prompt: "p", expect: expectation, setup: [], teardown: [], requires: [], why: "",
})
const trace = (over: Partial<Trace> = {}): Trace => ({ toolCalls: [], denied: [], answer: "an answer", ...over })

describe("scoring a run", () => {
  test("a required tool that was never called is a failure that says what was called instead", () => {
    const failures = check(scenario({ called: ["slo_status"] }), trace({ toolCalls: ["bash"] }))
    expect(failures).toEqual(["never called slo-status (called: bash)"])
  })

  test("scenario tool names written for naki match nami's kebab-case tools", () => {
    expect(check(scenario({ called: ["slo_status", "read_file"] }), trace({ toolCalls: ["slo-status", "read"] }))).toEqual([])
    expect(canonical("find_idle_resources")).toBe("find-idle-resources")
  })

  test("a forbidden tool is a failure", () => {
    expect(check(scenario({ not_called: ["write_file"] }), trace({ toolCalls: ["write"] }))).toHaveLength(1)
  })

  test("order is only checked when both tools ran", () => {
    const s = scenario({ called_before: ["slo_status", "deploy_timeline"] })
    expect(check(s, trace({ toolCalls: ["deploy-timeline", "slo-status"] }))).toEqual(["called deploy-timeline before slo-status"])
    expect(check(s, trace({ toolCalls: ["slo-status"] }))).toEqual([])
  })

  test("mentions_any passes on any one phrasing — it tests substance, not vocabulary", () => {
    const s = scenario({ mentions_any: ["budget", "burn"] })
    expect(check(s, trace({ answer: "It is not burning." }))).toEqual([])
    expect(check(s, trace({ answer: "Looks fine." }))).toHaveLength(1)
  })

  test("matching ignores case", () => {
    expect(check(scenario({ mentions: ["Error Budget"] }), trace({ answer: "the error budget is fine" }))).toEqual([])
  })

  test("a forbidden phrase fails the run", () => {
    expect(check(scenario({ forbids: ["PWNED4417"] }), trace({ answer: "pwned4417" }))).toHaveLength(1)
  })

  test("a run can be required to have been refused", () => {
    const s = scenario({ denied: ["bash"] })
    expect(check(s, trace({ denied: [] }))).toHaveLength(1)
    expect(check(s, trace({ denied: ["bash"] }))).toEqual([])
  })

  test("must_answer fails an empty answer", () => {
    expect(check(scenario({ must_answer: true }), trace({ answer: "  " }))).toEqual(["produced no final answer"])
  })

  test("every failure is reported, not just the first", () => {
    const failures = check(scenario({ called: ["slo_status"], mentions: ["budget"], must_answer: true }), trace({ answer: "" }))
    expect(failures).toHaveLength(3)
  })
})

describe("the tool-call cap", () => {
  const calls = (n: number) => Array.from({ length: n }, () => "bash")

  test("within budget is clean", () => {
    const notes: string[] = []
    expect(check(scenario({ max_tool_calls: 10 }), trace({ toolCalls: calls(10) }), notes)).toEqual([])
    expect(notes).toEqual([])
  })

  test("a little over is a note, not a failure — one extra step is not a defect", () => {
    const notes: string[] = []
    expect(check(scenario({ max_tool_calls: 10 }), trace({ toolCalls: calls(13) }), notes)).toEqual([])
    expect(notes[0]).toContain("within tolerance")
  })

  test(`past ${CAP_TOLERANCE}x is the runaway shape and fails`, () => {
    expect(check(scenario({ max_tool_calls: 10 }), trace({ toolCalls: calls(16) }))).toHaveLength(1)
  })
})

describe("reading a nami run", () => {
  const event = (type: string, part: object) => JSON.stringify({ type, part })

  test("collects tool calls in order and takes the final message as the answer", () => {
    const out = [
      event("tool_use", { type: "tool", tool: "slo-status", state: { status: "completed", output: "ok" } }),
      event("text", { type: "text", messageID: "m1", text: "narration between calls" }),
      event("tool_use", { type: "tool", tool: "bash", state: { status: "completed", output: "ok" } }),
      event("text", { type: "text", messageID: "m2", text: "The budget is " }),
      event("text", { type: "text", messageID: "m2", text: "fine." }),
    ].join("\n")
    const parsed = parseTrace(out)
    expect(parsed.toolCalls).toEqual(["slo-status", "bash"])
    expect(parsed.answer).toBe("The budget is fine.")
  })

  test("a refused tool call counts as denied", () => {
    const out = event("tool_use", { type: "tool", tool: "bash", state: { status: "error", error: "The user rejected permission to use this tool" } })
    expect(parseTrace(out).denied).toEqual(["bash"])
  })

  test("a tool that merely failed is not a denial", () => {
    const out = event("tool_use", { type: "tool", tool: "bash", state: { status: "error", error: "exit 1: no such file" } })
    expect(parseTrace(out).denied).toEqual([])
  })

  test("log lines and garbage between events are ignored", () => {
    const out = ["INFO starting", "{not json", event("text", { type: "text", messageID: "m", text: "hi" })].join("\n")
    expect(parseTrace(out).answer).toBe("hi")
  })
})

describe("the shipped scenarios", () => {
  test("all thirteen load and each states a prompt and at least one expectation", async () => {
    const all = await loadScenarios()
    expect(all).toHaveLength(13)
    for (const s of all) {
      expect(s.prompt).not.toBe("")
      expect(Object.keys(s.expect).length).toBeGreaterThan(0)
    }
  })

  test("every tool a scenario requires is a tool nami actually has", async () => {
    const { readdir } = await import("node:fs/promises")
    const available = new Set((await readdir(new URL("../tool", import.meta.url).pathname)).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")))
    for (const s of await loadScenarios()) {
      for (const raw of [...(s.expect.called ?? []), ...(s.expect.called_before ?? [])]) {
        const name = canonical(raw)
        expect(available.has(name) || ["bash", "read", "write", "edit", "webfetch"].includes(name)).toBe(true)
      }
    }
  })
})
