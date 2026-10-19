import { appendFile, readFile, chmod, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

// Ported from naki-cli (naki/agent/incidents.py) — organizational memory:
// the journal of incidents this team has already lived through. Append-only
// JSONL, project-local, same as the original.
//
// Not ported: naki.backend.client (optional shared-backend mirroring). box
// has no equivalent team backend yet, so this is local-journal-only — the
// write that matters (the local one, which "keeps working when the shared
// one is unreachable") is exactly what's here.

export const JOURNAL_PATH = path.join(".naki", "incidents.jsonl")

export type Incident = {
  title: string
  service: string
  symptom: string
  root_cause: string
  resolution: string
  related_change: string
  tags: string[]
  logged_at: string
}

export function searchable(i: Incident): string {
  return [i.title, i.service, i.symptom, i.root_cause, i.resolution, i.tags.join(" ")].join(" ").toLowerCase()
}

export function summary(i: Incident): string {
  const when = i.logged_at.slice(0, 10) || "?"
  let head = `${when}  ${i.title}`
  if (i.service) head += `  [${i.service}]`
  const lines = [head]
  if (i.symptom) lines.push(`    symptom: ${i.symptom}`)
  if (i.root_cause) lines.push(`    root cause: ${i.root_cause}`)
  if (i.resolution) lines.push(`    resolution: ${i.resolution}`)
  if (i.related_change) lines.push(`    traced to: ${i.related_change}`)
  if (i.tags.length) lines.push(`    tags: ${i.tags.join(", ")}`)
  return lines.join("\n")
}

function filePath(root = process.cwd()): string {
  return path.join(root, JOURNAL_PATH)
}

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "to", "for", "and", "or", "due", "with",
  "after", "before", "by", "at", "is", "was", "are", "were", "from", "into",
  "error", "errors", "issue", "issues", "problem", "failure", "failures",
])
const SUFFIXES = ["ations", "ation", "ing", "ities", "ity", "ies", "ed", "es", "s"]

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length)
  }
  return word
}

function titleTokens(title: string): Set<string> {
  const words = (title ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(words.filter((w) => !STOPWORDS.has(w) && w.length > 1).map(stem))
}

export async function allIncidents(root = process.cwd()): Promise<Incident[]> {
  const p = filePath(root)
  if (!existsSync(p)) return []
  const text = await readFile(p, "utf-8")
  const found: Incident[] = []
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

export async function similarRecent(incident: Incident, root = process.cwd(), withinHours = 6, overlap = 0.5): Promise<Incident | null> {
  const mine = titleTokens(incident.title)
  if (!mine.size) return null
  const cutoff = Date.now() - withinHours * 3600 * 1000

  const all = await allIncidents(root)
  for (const other of [...all].reverse()) {
    const when = Date.parse(other.logged_at)
    if (!Number.isFinite(when) || when < cutoff) continue
    if ((other.service || "").toLowerCase() !== (incident.service || "").toLowerCase()) continue
    const theirs = titleTokens(other.title)
    if (!theirs.size) continue
    const shared = [...mine].filter((t) => theirs.has(t)).length
    const union = new Set([...mine, ...theirs]).size
    if (shared / union >= overlap) return other
  }
  return null
}

export async function log(incident: Incident, root = process.cwd()): Promise<Incident> {
  incident.logged_at = incident.logged_at || new Date().toISOString().slice(0, 19)
  const p = filePath(root)
  await mkdir(path.dirname(p), { recursive: true })
  await appendFile(p, JSON.stringify(incident) + "\n", { mode: 0o600 })
  await chmod(p, 0o600).catch(() => {})
  return incident
}

export async function search(query: string, root = process.cwd(), limit = 10): Promise<Incident[]> {
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const all = await allIncidents(root)
  if (!terms.length) return [...all].reverse().slice(0, limit)

  const scored: [number, string, Incident][] = []
  for (const incident of all) {
    const haystack = searchable(incident)
    const hits = terms.filter((t) => haystack.includes(t)).length
    if (hits) scored.push([hits, incident.logged_at, incident])
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].localeCompare(a[1]))
  return scored.slice(0, limit).map(([, , i]) => i)
}
