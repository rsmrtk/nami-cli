import { parse as parseYaml } from "yaml"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { instant } from "./prometheus"
import { parseDuration } from "./prometheus"

// Ported from naki-cli (naki/agent/slo.py + tools/slo_status.py).

export const SLO_PATH = path.join(".naki", "slos.yaml")

export type SLODefinition = { name: string; objective: number; window: string; good: string; total: string; service: string }
export type SLOStatus = {
  slo: SLODefinition
  sli: number | null
  budgetConsumed: number | null
  burnRates: Record<string, number>
  alerts: string[]
  problems: string[]
}

export function budgetRemaining(status: SLOStatus): number | null {
  if (status.budgetConsumed === null) return null
  return Math.max(0, 1 - status.budgetConsumed)
}

// (long window, short window, burn-rate threshold, severity) — the
// multi-window, multi-burn-rate method from the Google SRE workbook.
export const BURN_WINDOWS: [string, string, number, "page" | "ticket"][] = [
  ["1h", "5m", 14.4, "page"],
  ["6h", "30m", 6.0, "page"],
  ["1d", "2h", 3.0, "ticket"],
  ["3d", "6h", 1.0, "ticket"],
]

const SHORT_WINDOWS = [...new Set(BURN_WINDOWS.flatMap(([l, s]) => [l, s]))].sort((a, b) => parseDuration(a) - parseDuration(b))

export async function load(root = process.cwd()): Promise<{ slos: Record<string, SLODefinition>; problems: string[] }> {
  const filePath = path.join(root, SLO_PATH)
  if (!existsSync(filePath)) return { slos: {}, problems: [] }

  let data: any
  try {
    data = parseYaml(await readFile(filePath, "utf-8")) ?? {}
  } catch (exc: any) {
    return { slos: {}, problems: [`${filePath} is not valid YAML: ${exc.message}`] }
  }

  const raw = data?.slos
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { slos: {}, problems: [`${filePath} has no 'slos:' mapping at the top level.`] }
  }

  const slos: Record<string, SLODefinition> = {}
  const problems: string[] = []
  for (const [name, entry] of Object.entries(raw as Record<string, any>)) {
    if (typeof entry !== "object" || entry === null) {
      problems.push(`SLO '${name}' is not a mapping — skipped`)
      continue
    }
    const missing = ["objective", "good", "total"].filter((k) => !entry[k])
    if (missing.length) {
      problems.push(`SLO '${name}' is missing ${missing.join(", ")} — skipped`)
      continue
    }
    const objective = parseFloat(entry.objective)
    if (!Number.isFinite(objective)) {
      problems.push(`SLO '${name}' has a non-numeric objective — skipped`)
      continue
    }
    if (!(objective > 0 && objective < 100)) {
      problems.push(`SLO '${name}' objective must be a percentage between 0 and 100 — skipped`)
      continue
    }
    slos[name] = {
      name,
      objective,
      window: String(entry.window ?? "30d"),
      good: String(entry.good),
      total: String(entry.total),
      service: String(entry.service ?? ""),
    }
  }
  return { slos, problems }
}

export function errorBudget(objective: number): number {
  return (100 - objective) / 100
}

export function burnRate(sli: number, objective: number): number {
  const budget = errorBudget(objective)
  return budget <= 0 ? 0 : (1 - sli) / budget
}

export function evaluateAlerts(burnRates: Record<string, number>): string[] {
  const alerts: string[] = []
  for (const [longWindow, shortWindow, threshold, severity] of BURN_WINDOWS) {
    const longRate = burnRates[longWindow]
    const shortRate = burnRates[shortWindow]
    if (longRate === undefined || shortRate === undefined) continue
    if (longRate >= threshold && shortRate >= threshold) {
      alerts.push(`${severity.toUpperCase()}: burning ${longRate.toFixed(1)}x over ${longWindow} (and ${shortRate.toFixed(1)}x over ${shortWindow}, threshold ${threshold}x)`)
    }
  }
  return alerts
}

async function ratioOver(definition: SLODefinition, window: string): Promise<[number | null, string]> {
  const query = `(sum(avg_over_time((${definition.good})[${window}:])) / sum(avg_over_time((${definition.total})[${window}:])))`
  return instant(query)
}

export async function measure(definition: SLODefinition): Promise<SLOStatus> {
  const status: SLOStatus = { slo: definition, sli: null, budgetConsumed: null, burnRates: {}, alerts: [], problems: [] }

  const [sli, problem] = await ratioOver(definition, definition.window)
  if (sli === null) {
    status.problems.push(problem)
    return status
  }
  status.sli = sli
  const budget = errorBudget(definition.objective)
  status.budgetConsumed = budget > 0 ? Math.min((1 - sli) / budget, 1) : 0

  for (const window of SHORT_WINDOWS) {
    const [value, windowProblem] = await ratioOver(definition, window)
    if (value === null) {
      status.problems.push(`${window}: ${windowProblem}`)
      continue
    }
    status.burnRates[window] = burnRate(value, definition.objective)
  }
  status.alerts = evaluateAlerts(status.burnRates)
  return status
}

export function describe(status: SLOStatus): string {
  const slo = status.slo
  const lines = [`${slo.name} — objective ${slo.objective}% over ${slo.window}`]
  if (slo.service) lines.push(`  service: ${slo.service}`)

  if (status.sli === null) {
    lines.push("  SLI: could not be measured")
    lines.push(...status.problems.map((p) => `  ! ${p}`))
    return lines.join("\n")
  }

  lines.push(`  SLI now: ${(status.sli * 100).toFixed(3)}%  (objective ${slo.objective}%)`)

  if (status.budgetConsumed !== null) {
    const remaining = budgetRemaining(status) ?? 0
    lines.push(`  error budget: ${(remaining * 100).toFixed(1)}% remaining (${(status.budgetConsumed * 100).toFixed(1)}% consumed this window)`)
    if (remaining <= 0) lines.push("  budget is exhausted — by the team's own objective, this is a freeze")
  }

  if (Object.keys(status.burnRates).length) {
    const rates = Object.entries(status.burnRates).map(([w, r]) => `${w}=${r.toFixed(1)}x`).join("  ")
    lines.push(`  burn rate: ${rates}`)
  }

  lines.push(...(status.alerts.length ? status.alerts.map((a) => `  ${a}`) : ["  no burn-rate alert would be firing"]))
  lines.push(...status.problems.map((p) => `  ! ${p}`))
  return lines.join("\n")
}
