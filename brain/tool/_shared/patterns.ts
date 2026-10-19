import { parse as parseYaml } from "yaml"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"

// Ported from naki-cli (naki/agent/patterns.py). The FinOps pattern pack:
// what to look for, and what it costs in reliability. Three rules enforced
// here rather than trusted — a threshold must carry a written reason, a
// price's provenance is data not memory, and a pattern claiming savings
// must state its reliability cost and at least one guard.

export class PatternError extends Error {}

export type Threshold = { value: number; reason: string; observedOn: number }
export type Pattern = {
  id: string
  title: string
  domain: string
  provider: string
  signal: Record<string, any>
  reliabilityCost: string
  guards: string[]
  thresholds: Record<string, Threshold>
  prices: Record<string, Threshold>
  runbook?: string
  verified: boolean
  observedOn: number
  source: string
}

const REQUIRED = ["id", "title", "domain", "provider", "signal", "reliability"]
const ALLOWED = new Set([...REQUIRED, "thresholds", "prices", "runbook", "verified", "observed_on", "source", "notes"])
const PROVIDERS = new Set(["aws", "gcp", "azure", "k8s", "any"])

function measured(t: Threshold): boolean {
  // Three observations is the bar this project settled on after a limit set
  // from one guess failed correct runs.
  return t.observedOn >= 3
}

export function threshold(pattern: Pattern, name: string): number {
  const t = pattern.thresholds[name]
  if (!t) throw new PatternError(`pattern ${pattern.id} has no threshold '${name}'`)
  return t.value
}

export function price(pattern: Pattern, name: string): number {
  const p = pattern.prices[name]
  if (!p) throw new PatternError(`pattern ${pattern.id} has no price '${name}'`)
  return p.value
}

export function caveat(pattern: Pattern): string {
  if (pattern.verified) return ""
  const unmeasuredPrices = Object.keys(pattern.prices).filter((n) => !measured(pattern.prices[n]!)).sort()
  const unmeasuredThresholds = Object.keys(pattern.thresholds).filter((n) => !measured(pattern.thresholds[n]!)).sort()
  if (!unmeasuredPrices.length && !unmeasuredThresholds.length) return `(${pattern.id}: not yet checked against a real bill)`

  const parts: string[] = []
  if (unmeasuredPrices.length) parts.push(`${unmeasuredPrices.join(", ")} are public list prices, not this bill`)
  if (unmeasuredThresholds.length) parts.push(`${unmeasuredThresholds.join(", ")} set below three observations — placeholder`)
  return `(${pattern.id}: ${parts.join("; ")})`
}

function parseThresholds(raw: any, kind: string, patternId: string): Record<string, Threshold> {
  if (raw == null) return {}
  if (typeof raw !== "object" || Array.isArray(raw)) throw new PatternError(`${patternId}: ${kind} must be a mapping of name → {value, reason}`)

  const parsed: Record<string, Threshold> = {}
  for (const [name, body] of Object.entries(raw as Record<string, any>)) {
    if (typeof body !== "object" || body === null || !("value" in body)) {
      throw new PatternError(`${patternId}: ${kind}.${name} must be a mapping with a value`)
    }
    const reason = String(body.reason ?? "").trim()
    if (!reason) {
      throw new PatternError(`${patternId}: ${kind}.${name} has no reason — a threshold without a written reason cannot be reviewed, so it does not load`)
    }
    const value = parseFloat(body.value)
    if (!Number.isFinite(value)) throw new PatternError(`${patternId}: ${kind}.${name} value is not a number`)
    parsed[name] = { value, reason, observedOn: parseInt(body.observed_on ?? 0, 10) || 0 }
  }
  return parsed
}

export function parse(raw: any): Pattern {
  if (typeof raw !== "object" || raw === null) throw new PatternError("pattern file must contain a mapping")

  const missing = REQUIRED.filter((k) => !(k in raw))
  if (missing.length) throw new PatternError(`missing required key(s): ${missing.sort().join(", ")}`)
  const unknown = Object.keys(raw).filter((k) => !ALLOWED.has(k))
  if (unknown.length) throw new PatternError(`unknown key(s): ${unknown.sort().join(", ")}`)

  const patternId = String(raw.id)
  const provider = String(raw.provider).toLowerCase()
  if (!PROVIDERS.has(provider)) throw new PatternError(`${patternId}: provider must be one of ${[...PROVIDERS].sort().join(", ")}`)

  const reliability = raw.reliability
  if (typeof reliability !== "object" || reliability === null) throw new PatternError(`${patternId}: reliability must be a mapping`)
  const cost = String(reliability.cost ?? "").trim()
  const guards = reliability.guards ?? []
  if (!cost) throw new PatternError(`${patternId}: reliability.cost is required — state what acting on this risks`)
  if (!Array.isArray(guards) || !guards.length) {
    throw new PatternError(`${patternId}: reliability.guards must list at least one guard — a saving without a guard is the advice a read-only tool gives`)
  }

  const signal = raw.signal
  if (typeof signal !== "object" || signal === null || !signal.tool) {
    throw new PatternError(`${patternId}: signal.tool is required — name the tool that detects this`)
  }

  return {
    id: patternId,
    title: String(raw.title),
    domain: String(raw.domain),
    provider,
    signal,
    reliabilityCost: cost,
    guards: guards.map(String),
    thresholds: parseThresholds(raw.thresholds, "thresholds", patternId),
    prices: parseThresholds(raw.prices, "prices", patternId),
    runbook: raw.runbook ? String(raw.runbook) : undefined,
    verified: Boolean(raw.verified ?? false),
    observedOn: parseInt(raw.observed_on ?? 0, 10) || 0,
    source: String(raw.source ?? "local"),
  }
}

export function packDir(root = process.cwd()): string {
  return path.join(root, ".naki", "patterns")
}

export async function load(root = process.cwd()): Promise<{ patterns: Record<string, Pattern>; problems: string[] }> {
  const directory = packDir(root)
  if (!existsSync(directory)) return { patterns: {}, problems: [] }

  const found: Record<string, Pattern> = {}
  const problems: string[] = []
  const files = (await readdir(directory)).filter((f) => f.endsWith(".yaml")).sort()
  for (const file of files) {
    const filePath = path.join(directory, file)
    let raw: any
    try {
      raw = parseYaml(await readFile(filePath, "utf-8"))
    } catch (exc: any) {
      problems.push(`${file}: not readable YAML (${exc.message})`)
      continue
    }
    try {
      const pattern = parse(raw)
      if (found[pattern.id]) {
        problems.push(`${file}: duplicate pattern id ${pattern.id}`)
        continue
      }
      found[pattern.id] = pattern
    } catch (exc: any) {
      if (exc instanceof PatternError) {
        problems.push(`${file}: ${exc.message}`)
        continue
      }
      throw exc
    }
  }
  return { patterns: found, problems }
}

export async function get(patternId: string, root = process.cwd()): Promise<Pattern | null> {
  const { patterns } = await load(root)
  return patterns[patternId] ?? null
}
