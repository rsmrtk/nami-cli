import { tool } from "@rsmrtk/plugin"
import { kubectlJson } from "./_shared/kubectl-json"
import { settings } from "./_shared/settings"
import { instant, parseDuration, noPrometheusError } from "./_shared/prometheus"
import * as Slo from "./_shared/slo"
import * as Patterns from "./_shared/patterns"
import * as Evidence from "./_shared/evidence"

// Ported from naki-cli (naki/agent/tools/k8s_rightsizing.py). See that
// file's own docstring for why the guards here are conditions, not advice:
// not enough usage history means no recommendation at all; a burning error
// budget means no recommendation for that service; memory is judged on its
// observed peak rather than a percentile, because OOMKill is not gradual;
// and no single step cuts more than the pattern's max_cut_pct.
//
// Deliberately absent, same as the original: money. A dollar figure needs
// OpenCost/Kubecost, so this reports cores and bytes and points at
// k8s_cost_breakdown instead of inventing a rate.

const PATTERN_ID = "k8s-over-request"
const FALLBACKS = { window_days: 7.0, headroom_multiple: 1.3, min_waste_pct: 40.0, max_cut_pct: 30.0 }

const MEM_UNITS: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4 }

async function knobs(): Promise<{ values: Record<string, number>; caveat: string }> {
  try {
    const pattern = await Patterns.get(PATTERN_ID)
    if (pattern) {
      const values: Record<string, number> = {}
      for (const name of Object.keys(FALLBACKS)) values[name] = Patterns.threshold(pattern, name)
      return { values, caveat: Patterns.caveat(pattern) }
    }
  } catch {
    // fall through to built-ins
  }
  return { values: { ...FALLBACKS }, caveat: `(${PATTERN_ID}: pattern file not found — built-in defaults)` }
}

// Exported for the same reason naki's own module exposes these at top
// level: so a test can check the arithmetic directly against naki's
// pinned fixtures, without standing up kubectl + Prometheus.
export function cores(value: unknown): number | null {
  if (value == null) return null
  const text = String(value).trim()
  try {
    if (text.endsWith("m")) return parseFloat(text.slice(0, -1)) / 1000
    if (text.endsWith("n")) return parseFloat(text.slice(0, -1)) / 1e9
    if (text.endsWith("u")) return parseFloat(text.slice(0, -1)) / 1e6
    const v = parseFloat(text)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export function byteSize(value: unknown): number | null {
  if (value == null) return null
  const text = String(value).trim()
  for (const [suffix, factor] of Object.entries(MEM_UNITS)) {
    if (text.endsWith(suffix)) {
      const v = parseFloat(text.slice(0, -suffix.length))
      return Number.isFinite(v) ? v * factor : null
    }
  }
  const v = parseFloat(text)
  return Number.isFinite(v) ? v : null
}

export function mem(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)}Gi`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)}Mi`
  return `${(value / 1024).toFixed(0)}Ki`
}

type Row = {
  namespace: string
  workload: string
  container: string
  replicas: number
  readyReplicas: number | null
  cpuRequest: number | null
  memRequest: number | null
  cpuLimit: number | null
  memLimit: number | null
  cpuP95?: number | null
  memPeak?: number | null
  cpuFloor?: number
  memFloor?: number
}

async function workloads(namespace?: string): Promise<Row[]> {
  const scope = namespace ? ["-n", namespace] : ["-A"]
  const { data, error } = await kubectlJson(["get", "deployments", ...scope])
  if (!data) throw new Error(error)

  const found: Row[] = []
  for (const item of data.items ?? []) {
    const meta = item.metadata ?? {}
    const spec = item.spec ?? {}
    const status = item.status ?? {}
    const desired = spec.replicas ?? 1
    const ready = status.readyReplicas ?? 0
    const containers = spec.template?.spec?.containers ?? []
    for (const container of containers) {
      const resources = container.resources ?? {}
      const requests = resources.requests ?? {}
      const limits = resources.limits ?? {}
      found.push({
        namespace: meta.namespace ?? "?",
        workload: meta.name ?? "?",
        container: container.name ?? "?",
        replicas: desired,
        readyReplicas: ready,
        cpuRequest: cores(requests.cpu),
        memRequest: byteSize(requests.memory),
        cpuLimit: cores(limits.cpu),
        memLimit: byteSize(limits.memory),
      })
    }
  }
  return found
}

function notServing(row: Row): string {
  const desired = row.replicas || 0
  const ready = row.readyReplicas
  if (ready === null) return ""
  if (desired && ready === 0) return `none of the ${desired} replica(s) are Ready`
  if (desired && ready < desired) return `only ${ready} of ${desired} replicas are Ready`
  return ""
}

function underProvisioned(row: Row): string {
  const peak = row.memPeak
  if (peak == null) return ""
  const limit = row.memLimit
  const request = row.memRequest
  if (limit && peak >= limit * 0.8) {
    return `peak ${mem(peak)} is at or over 80% of the ${mem(limit)} limit — this container is being squeezed, and a kernel OOM kill is what that looks like next (the sampled peak is always below the one that triggers the kill)`
  }
  if (request && peak > request) {
    return `peak ${mem(peak)} exceeds the ${mem(request)} request — the scheduler is guaranteeing less than this container actually uses`
  }
  return ""
}

async function historySeconds(namespace: string, window: string): Promise<[number | null, string]> {
  const query =
    `max(max_over_time(timestamp(container_memory_working_set_bytes{namespace="${namespace}",container!=""})[${window}:1m]) ` +
    `- min_over_time(timestamp(container_memory_working_set_bytes{namespace="${namespace}",container!=""})[${window}:1m]))`
  return instant(query)
}

async function cpuP95(row: Row, window: string): Promise<number | null> {
  const selector = `namespace="${row.namespace}",container="${row.container}",pod=~"${row.workload}-.*"`
  const [value] = await instant(`quantile_over_time(0.95, max(rate(container_cpu_usage_seconds_total{${selector}}[5m]))[${window}:5m])`)
  return value
}

async function memPeak(row: Row, window: string): Promise<number | null> {
  const selector = `namespace="${row.namespace}",container="${row.container}",pod=~"${row.workload}-.*"`
  const [value] = await instant(`max_over_time(max(container_memory_working_set_bytes{${selector}})[${window}:1m])`)
  return value
}

async function budgetBlock(namespace: string, workload: string): Promise<string | null> {
  const { slos } = await Slo.load()
  for (const definition of Object.values(slos)) {
    const target = definition.service || definition.name
    if (!workload.includes(target) && !target.includes(workload)) continue
    const status = await Slo.measure(definition)
    const remaining = Slo.budgetRemaining(status)
    if (remaining !== null && remaining <= 0) {
      return `error budget for SLO '${definition.name}' is exhausted (SLI ${status.sli?.toFixed(4)} against ${definition.objective}%) — cutting capacity now would spend reliability that is already gone`
    }
    if (status.alerts.some((a) => a.toLowerCase().startsWith("page") || a.toLowerCase().includes("page"))) {
      return `SLO '${definition.name}' is paging — not the moment to shrink it`
    }
  }
  return null
}

function measuredLine(row: Row): string {
  const parts: string[] = []
  if (row.cpuRequest) {
    const used = row.cpuP95
    const seen = used != null ? `p95 ${used.toFixed(4)}` : "no usage data"
    parts.push(`cpu request ${row.cpuRequest.toFixed(3)} cores, ${seen}`)
  }
  if (row.memRequest) {
    const used = row.memPeak
    const seen = used != null ? `peak ${mem(used)}` : "no usage data"
    parts.push(`memory request ${mem(row.memRequest)}, ${seen}`)
  }
  if (!parts.length) parts.push("no requests declared — nothing reserved, so nothing to reclaim")
  return parts.join("; ")
}

function noRequestsLine(row: Row): string {
  if (row.cpuRequest || row.memRequest) return "requests are declared but Prometheus holds no usage for this container — nothing measured, so nothing recommended"
  return "no requests declared — nothing reserved, so nothing to reclaim"
}

export function recommend(row: Row, k: Record<string, number>): [string, number, number] {
  const parts: string[] = []
  let cpuSaved = 0
  let memSaved = 0

  if (row.cpuRequest && row.cpuP95 != null) {
    const request = row.cpuRequest
    const used = row.cpuP95
    const wanted = used * k.headroom_multiple!
    const floor = request * (1 - k.max_cut_pct! / 100)
    const proposed = Math.max(wanted, floor)
    const waste = ((request - wanted) / request) * 100
    if (waste >= k.min_waste_pct! && proposed < request) {
      cpuSaved = (request - proposed) * row.replicas
      row.cpuFloor = proposed
      const capped = proposed > wanted + 1e-12 ? " (capped by max_cut_pct)" : ""
      parts.push(`cpu ${request.toFixed(3)} → ${proposed.toFixed(3)} cores (p95 ${used.toFixed(4)}, ${waste.toFixed(0)}% over)${capped}`)
    } else {
      parts.push(`cpu ${request.toFixed(3)} cores holds (p95 ${used.toFixed(4)})`)
    }
  }

  if (row.memRequest && row.memPeak != null) {
    const request = row.memRequest
    const used = row.memPeak
    const wanted = used * k.headroom_multiple!
    const floor = request * (1 - k.max_cut_pct! / 100)
    const proposed = Math.max(wanted, floor)
    const waste = ((request - wanted) / request) * 100
    if (waste >= k.min_waste_pct! && proposed < request) {
      memSaved = (request - proposed) * row.replicas
      row.memFloor = proposed
      const capped = proposed > wanted + 1e-12 ? " (capped by max_cut_pct)" : ""
      parts.push(`memory ${mem(request)} → ${mem(proposed)} (peak ${mem(used)}, ${waste.toFixed(0)}% over)${capped}`)
    } else {
      parts.push(`memory ${mem(request)} holds (peak ${mem(used)})`)
    }
  }

  const shortfall = underProvisioned(row)
  if (shortfall) parts.unshift(shortfall)
  if (!parts.length) parts.push(noRequestsLine(row))
  return [parts.join("; "), cpuSaved, memSaved]
}

export default tool({
  description: `Compare Kubernetes CPU/memory requests against what the containers actually used, measured from Prometheus, and propose safe reductions. Refuses to recommend anything when the usage history is shorter than the pattern's window or when the service's error budget is burning — a request is a scheduling guarantee, not a hint. Reports cores and bytes, not dollars: pricing k8s requests needs k8s_cost_breakdown.`,
  args: {
    namespace: tool.schema.string().describe("Namespace to examine. Omit for every namespace.").optional(),
    window: tool.schema.string().describe("Override the pattern's observation window, e.g. '7d'.").optional(),
  },
  async execute(args) {
    if (!settings.prometheusUrl) return { title: "k8s_rightsizing", output: noPrometheusError() }

    const { values: k, caveat } = await knobs()
    const window = args.window || `${Math.trunc(k.window_days!)}d`

    let rows: Row[]
    try {
      rows = await workloads(args.namespace)
    } catch (exc: any) {
      return { title: "k8s_rightsizing", output: `Error: ${exc.message}` }
    }
    if (!rows.length) return { title: "k8s_rightsizing", output: "No deployments found in scope." }

    const namespaces = [...new Set(rows.map((r) => r.namespace))].sort()
    const historyByNs = new Map<string, [number | null, string]>()
    for (const ns of namespaces) historyByNs.set(ns, await historySeconds(ns, window))
    const wantedSeconds = parseDuration(window)

    const sections: string[] = []
    let totalCpu = 0
    let totalMem = 0
    let recommending = false

    for (const namespace of namespaces) {
      const [held, problem] = historyByNs.get(namespace)!
      const enough = held !== null && held >= wantedSeconds * 0.8
      const lines: string[] = []

      for (const row of rows.filter((r) => r.namespace === namespace)) {
        row.cpuP95 = await cpuP95(row, window)
        row.memPeak = await memPeak(row, window)

        if (!enough) {
          lines.push(`  ${row.workload}/${row.container}: ${measuredLine(row)}  [observation only]`)
          Evidence.recordDecline(namespace, row.workload, `only ${((held ?? 0) / 3600).toFixed(1)}h of usage history against a ${window} window`)
          continue
        }

        const idleBecauseBroken = notServing(row)
        const shortfallNow = underProvisioned(row)
        if (shortfallNow) Evidence.recordSqueezed(namespace, row.workload, shortfallNow)
        if (idleBecauseBroken) {
          const detail = shortfallNow ? `; ${shortfallNow}` : ""
          lines.push(`  ${row.workload}/${row.container}: ${measuredLine(row)}${detail}  [observation only: ${idleBecauseBroken}, so this usage is not evidence about its capacity]`)
          Evidence.recordDecline(namespace, row.workload, idleBecauseBroken)
          continue
        }

        const [verdict, cpuSaved, memSaved] = recommend(row, k)
        const block = await budgetBlock(namespace, row.workload)
        if (block) {
          lines.push(`  ${row.workload}/${row.container}: ${verdict}  [held back: ${block}]`)
          continue
        }

        lines.push(`  ${row.workload}/${row.container}: ${verdict}`)
        if (cpuSaved || memSaved) Evidence.record(namespace, row.workload, row.container, row.cpuFloor ?? null, row.memFloor ?? null)
        totalCpu += cpuSaved
        totalMem += memSaved
        recommending = recommending || Boolean(cpuSaved || memSaved)
      }

      let note: string
      if (held === null && problem) note = `usage history unknown — ${problem}`
      else if (held === null) note = "no usage history in Prometheus for this namespace"
      else {
        note = `usage history: ${(held / 3600).toFixed(1)}h of the ${window} window asked for`
        if (!enough) note += " — under 80% coverage, so nothing is recommended here. A percentile over two minutes of data looks exactly like one over three weeks."
      }
      sections.push(`=== ${namespace} ===\n  (${note})\n` + lines.join("\n"))
    }

    const footer = [`\n\nwindow ${window}, headroom x${k.headroom_multiple}, cut capped at ${k.max_cut_pct}%. ${caveat}`]
    if (recommending) {
      footer.push(`Reclaimable if applied: ${totalCpu.toFixed(3)} cores and ${mem(totalMem)} of requests across the replicas counted.`)
      footer.push("Deliberately no currency figure: pricing requests needs OpenCost or Kubecost — ask k8s_cost_breakdown. Run blast_radius before applying anything to a single-replica workload.")
    } else {
      footer.push("No reductions proposed. That is a statement about the evidence available, not a verdict that every request is correct.")
    }
    return { title: "k8s_rightsizing", output: sections.join("\n\n") + " " + footer.join(" ") }
  },
})
