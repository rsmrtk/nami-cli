#!/usr/bin/env bun
// Runs the scenarios against the real agent (`nami run`), scoring what it did.
// Slow by nature — a real model doing real work — so this is a separate
// command from `bun test`.
//
//   bun brain/evals/run.ts                  all scenarios
//   bun brain/evals/run.ts 01 09            only those whose name starts with/contains the argument
//   MODEL=ollama/qwen3-coder:30b bun brain/evals/run.ts
import { spawnSync } from "node:child_process"
import path from "node:path"
import { check, loadScenarios, parseTrace, type Scenario } from "./runner"

const NAMI = path.resolve(import.meta.dir, "../../packages/nami")
const model = process.env.MODEL ?? "ollama/qwen3-coder:30b"
const filters = process.argv.slice(2)

function shell(commands: string[], label: string): string | null {
  for (const command of commands) {
    const r = spawnSync("sh", ["-c", command], { encoding: "utf-8", timeout: 60_000 })
    if (r.status !== 0) return `${label} failed (${command}): ${(r.stderr || "").trim().slice(0, 200)}`
  }
  return null
}

function unmet(scenario: Scenario): string | null {
  for (const condition of scenario.requires) {
    if (spawnSync("sh", ["-c", condition], { timeout: 30_000 }).status !== 0) return condition
  }
  return null
}

// The bench never lets the agent change a real cluster: permissions that
// would need approval are refused (no --auto), and the denial is what the
// scenario asserts on. Each run gets its own scratch project so nothing it
// writes — a policy file, an incident entry — lands in a real repository.
const scratch = spawnSync("mktemp", ["-d"], { encoding: "utf-8" }).stdout.trim()

const scenarios = (await loadScenarios()).filter((s) => !filters.length || filters.some((f) => s.name.includes(f)))
let failed = 0
for (const scenario of scenarios) {
  const skip = unmet(scenario)
  if (skip) {
    console.log(`SKIP  ${scenario.name} — unmet requirement: ${skip}`)
    continue
  }
  const setupError = shell(scenario.setup.map((c) => `cd ${scratch} && ${c}`), "setup")
  if (setupError) {
    console.log(`SKIP  ${scenario.name} — ${setupError}`)
    continue
  }
  const run = spawnSync(
    "bun",
    ["run", "src/index.ts", "run", "--format", "json", "--dir", scratch, "-m", model, scenario.prompt],
    { cwd: NAMI, encoding: "utf-8", timeout: 600_000, env: { ...process.env, RSMRTK_DISABLE_CLAUDE_CODE_SKILLS: "1" }, maxBuffer: 64 * 1024 * 1024 },
  )
  const teardownError = shell(scenario.teardown, "teardown")
  const trace = parseTrace(run.stdout ?? "")
  const notes: string[] = []
  const failures = check(scenario, trace, notes)
  if (teardownError) notes.push(teardownError)

  console.log(`${failures.length ? "FAIL" : "PASS"}  ${scenario.name}  (${trace.toolCalls.length} calls)`)
  for (const f of failures) console.log(`        - ${f}`)
  for (const n of notes) console.log(`        · ${n}`)
  if (failures.length) failed++
}
console.log(`\n${scenarios.length - failed} of ${scenarios.length} ran clean`)
process.exit(failed ? 1 : 0)
