import { appendFile, readFile, chmod, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

// Ported from naki-cli (naki/agent/cases.py) — the FinOps case ledger: what
// a pattern found, what was decided, and what it actually changed. Not
// ported: the shared-backend mirror (same scope cut as incidents.ts).

export const JOURNAL_PATH = path.join(".naki", "cases.jsonl")

export const APPROVED = "approved"
export const DECLINED = "declined"
export const DEFERRED = "deferred"
const DECISIONS = new Set([APPROVED, DECLINED, DEFERRED, ""])

export type Case = {
  pattern: string
  resource: string
  finding: string
  recommendation: string
  source: string
  decision: string
  decided_by: string
  applied_at: string
  baseline_amount: number | null
  after_amount: number | null
  currency: string
  measure_window_days: number
  confounders: string[]
  confounders_checked: boolean
  tags: string[]
  logged_at: string
}

export function saving(c: Case): number | null {
  if (c.baseline_amount == null || c.after_amount == null) return null
  return c.baseline_amount - c.after_amount
}

export function measured(c: Case): boolean {
  return c.decision === APPROVED && saving(c) !== null && c.confounders_checked
}

export function savingState(c: Case): string {
  if (c.decision === DECLINED || c.decision === DEFERRED) return `no saving claimed — ${c.decision}`
  if (c.decision !== APPROVED) return "no saving claimed — not decided yet"
  const s = saving(c)
  if (s === null) return "pending measurement — the window has not closed"
  if (!c.confounders_checked) {
    return "measured but unattributed — deploy_timeline was not consulted for the window, so this delta cannot be credited to the change"
  }
  let note = `measured saving ${s.toFixed(2)} ${c.currency}`
  if (c.measure_window_days) note += ` over ${c.measure_window_days}d`
  note += c.confounders.length ? `; other changes in the window: ${c.confounders.join(", ")}` : "; no other changes found in the window"
  return note
}

export function searchable(c: Case): string {
  return [c.pattern, c.resource, c.finding, c.recommendation, c.source, c.tags.join(" ")].filter(Boolean).join(" ").toLowerCase()
}

export function summary(c: Case): string {
  const when = (c.logged_at || "?").slice(0, 10)
  const lines = [`${when}  [${c.pattern}] ${c.resource}`]
  if (c.finding) lines.push(`    finding: ${c.finding}`)
  if (c.recommendation) lines.push(`    recommended: ${c.recommendation}`)
  if (c.source) lines.push(`    source: ${c.source}`)
  lines.push(`    outcome: ${savingState(c)}`)
  if (c.tags.length) lines.push(`    tags: ${c.tags.join(", ")}`)
  return lines.join("\n")
}

function filePath(root = process.cwd()): string {
  return path.join(root, JOURNAL_PATH)
}

export async function log(c: Case, root = process.cwd()): Promise<Case> {
  if (!DECISIONS.has(c.decision)) throw new Error(`decision must be one of ${[...DECISIONS].filter(Boolean).sort().join(", ")} or empty`)
  c.logged_at = c.logged_at || new Date().toISOString().slice(0, 19)
  const p = filePath(root)
  await mkdir(path.dirname(p), { recursive: true })
  await appendFile(p, JSON.stringify(c) + "\n", { mode: 0o600 })
  await chmod(p, 0o600).catch(() => {})
  return c
}

export async function allCases(root = process.cwd()): Promise<Case[]> {
  const p = filePath(root)
  if (!existsSync(p)) return []
  const text = await readFile(p, "utf-8")
  const found: Case[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      found.push(JSON.parse(trimmed))
    } catch {
      continue
    }
  }
  return found
}

export async function search(query: string, root = process.cwd(), limit = 10): Promise<Case[]> {
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const all = await allCases(root)
  if (!terms.length) return [...all].reverse().slice(0, limit)

  const scored: [number, string, Case][] = []
  for (const c of all) {
    const haystack = searchable(c)
    const hits = terms.filter((t) => haystack.includes(t)).length
    if (hits) scored.push([hits, c.logged_at, c])
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].localeCompare(a[1]))
  return scored.slice(0, limit).map(([, , c]) => c)
}

export async function totals(root = process.cwd()) {
  const all = await allCases(root)
  const measuredCases = all.filter(measured)
  const byCurrency: Record<string, number> = {}
  for (const c of measuredCases) byCurrency[c.currency] = (byCurrency[c.currency] ?? 0) + (saving(c) ?? 0)
  return {
    cases: all.length,
    approved: all.filter((c) => c.decision === APPROVED).length,
    declined: all.filter((c) => c.decision === DECLINED).length,
    deferred: all.filter((c) => c.decision === DEFERRED).length,
    measured: measuredCases.length,
    pending: all.filter((c) => c.decision === APPROVED && !measured(c)).length,
    savingByCurrency: byCurrency,
  }
}
