import { tool } from "@rsmrtk/plugin"
import { money } from "./_shared/cloud"
import { settings } from "./_shared/settings"

// Ported from naki-cli (naki/agent/tools/k8s_cost_breakdown.py) — full
// fidelity, no cloud CLI dependency to scope down: just HTTP to a
// Kubecost- or OpenCost-compatible allocation API.

function summarizeAllocation(payload: any, aggregate: string): string {
  const data = payload?.data
  if (!data) return "(allocation API returned no data for this window)"

  const window = Array.isArray(data) ? data[data.length - 1] : data
  if (typeof window !== "object" || window === null || !Object.keys(window).length) return "(no allocations in this window)"

  const rows: [string, number, any][] = []
  for (const [name, entry] of Object.entries<any>(window)) {
    if (typeof entry !== "object" || entry === null) continue
    let total = entry.totalCost
    if (total === undefined || total === null) {
      total = ["cpuCost", "ramCost", "gpuCost", "pvCost", "networkCost"].reduce((sum, key) => sum + (parseFloat(entry[key]) || 0), 0)
    }
    const totalNum = parseFloat(total)
    if (Number.isFinite(totalNum)) rows.push([name, totalNum, entry])
  }
  if (!rows.length) return "(no cost rows in this window)"

  rows.sort((a, b) => b[1] - a[1])
  const grandTotal = rows.reduce((sum, [, t]) => sum + t, 0)

  const lines = [`total: ${money(grandTotal)} across ${rows.length} ${aggregate}(s)`, ""]
  for (const [name, total, entry] of rows.slice(0, 20)) {
    const share = grandTotal ? (total / grandTotal) * 100 : 0
    const cpu = parseFloat(entry.cpuCost) || 0
    const ram = parseFloat(entry.ramCost) || 0
    lines.push(`  ${name.padEnd(34)} ${money(total).padStart(12)}  ${share.toFixed(1).padStart(5)}%   cpu ${money(cpu)} / ram ${money(ram)}`)
  }
  if (rows.length > 20) lines.push(`  … and ${rows.length - 20} more`)
  return lines.join("\n")
}

// Kubecost and OpenCost serve the same allocation data at different paths.
// Found by deploying OpenCost: /model/allocation is Kubecost's, and
// OpenCost answered it with a 404. Tried in order, first one that responds
// wins.
const ALLOCATION_PATHS = ["/model/allocation", "/allocation/compute", "/allocation"]

export default tool({
  description: `Cost per namespace / workload inside a shared Kubernetes cluster, via a Kubecost- or OpenCost-compatible API. A cloud bill says 'EKS: $18k'; this says which team's namespace spent it, which is the only version anyone can act on.`,
  args: {
    window: tool.schema.string().describe("Kubecost window: '1d', '7d', '30d'. Defaults to '7d'.").optional(),
    aggregate: tool.schema.string().describe("namespace (default), controller, deployment, or label:team.").optional(),
  },
  async execute(args) {
    if (!settings.kubecostUrl) {
      return {
        title: "k8s_cost_breakdown",
        output:
          "Error: no Kubecost/OpenCost endpoint configured. Set NAKI_KUBECOST_URL (e.g. http://localhost:9003 after `kubectl port-forward -n opencost svc/opencost 9003:9003`, or :9090 for Kubecost's cost-analyzer) and try again.",
      }
    }

    const window = args.window || "7d"
    const aggregate = args.aggregate || "namespace"
    const base = settings.kubecostUrl.replace(/\/+$/, "")
    const params = new URLSearchParams({ window, aggregate, accumulate: "true" })

    const attempts: string[] = []
    let payload: any = null
    let servedBy = ""
    for (const path of ALLOCATION_PATHS) {
      let response: Response
      try {
        response = await fetch(`${base}${path}?${params}`, { signal: AbortSignal.timeout(45_000) })
      } catch (exc: any) {
        return { title: "k8s_cost_breakdown", output: `Error querying the allocation API at ${base}: ${exc.message}` }
      }
      if (response.status === 404) {
        attempts.push(`${path} → 404`)
        continue
      }
      try {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        payload = await response.json()
      } catch (exc: any) {
        attempts.push(`${path} → ${exc.message}`)
        continue
      }
      servedBy = path.startsWith("/model") ? "Kubecost" : "OpenCost"
      break
    }

    if (payload === null) {
      return {
        title: "k8s_cost_breakdown",
        output: `Error: no allocation API answered at ${base}. Tried: ${attempts.join("; ")}. Check that NAKI_KUBECOST_URL points at a Kubecost cost-analyzer or an OpenCost service.`,
      }
    }

    const header = `Kubernetes cost by ${aggregate}, window ${window}`
    const source = `source: ${servedBy} at ${base} — cluster attribution, not billing data. Reconcile the total against the bill with cost_diagnose before quoting it.`
    return { title: "k8s_cost_breakdown", output: `${header}\n\n${summarizeAllocation(payload, aggregate)}\n\n${source}` }
  },
})
