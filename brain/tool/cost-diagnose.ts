import { tool } from "@rsmrtk/plugin"
import { CloudError, runCli, formatDelta, monthWindows } from "./_shared/cloud"
import { PROVIDERS, detectProvider } from "./_shared/clouds"

// Ported from naki-cli (naki/agent/tools/cost_diagnose.py) — AWS path only.
// GCP (BigQuery billing export) and Azure (Cost Management API / consumption
// records) are each their own module in naki that hasn't been ported yet;
// asking for them here returns an explicit error rather than a result built
// on logic that doesn't exist in this build.

const VALID_GROUPS = new Set(["SERVICE", "LINKED_ACCOUNT", "REGION", "USAGE_TYPE"])

function totalsByKey(payload: any): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const period of payload?.ResultsByTime ?? []) {
    for (const group of period.Groups ?? []) {
      const key = (group.Keys ?? ["(ungrouped)"])[0]
      const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "0")
      if (Number.isFinite(amount)) totals[key] = (totals[key] ?? 0) + amount
    }
  }
  return totals
}

async function fetchAws(start: string, end: string, groupBy: string): Promise<Record<string, number>> {
  const payload = await runCli([
    "aws", "ce", "get-cost-and-usage",
    "--time-period", `Start=${start},End=${end}`,
    "--granularity", "MONTHLY",
    "--metrics", "UnblendedCost",
    "--group-by", `Type=DIMENSION,Key=${groupBy}`,
    "--output", "json",
  ])
  return totalsByKey(payload)
}

function renderComparison(current: Record<string, number>, previous: Record<string, number>, groupBy: string): string {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)])
  if (!keys.size) return "(billing API returned no cost data for this window)"

  const rows = [...keys].sort((a, b) => Math.abs((current[b] ?? 0) - (previous[b] ?? 0)) - Math.abs((current[a] ?? 0) - (previous[a] ?? 0)))

  const totalNow = Object.values(current).reduce((a, b) => a + b, 0)
  const totalBefore = Object.values(previous).reduce((a, b) => a + b, 0)

  const lines = [`total: ${formatDelta(totalNow, totalBefore)}`, "", `by ${groupBy.toLowerCase()}, biggest movers first:`]
  let shown = 0
  for (const key of rows) {
    const now = current[key] ?? 0
    const before = previous[key] ?? 0
    if (now < 0.01 && before < 0.01) continue
    if (shown >= 15) break
    lines.push(`  ${key.padEnd(40)} ${formatDelta(now, before)}`)
    shown++
  }
  const tail = rows.length - 15
  if (tail > 0) lines.push(`  … and ${tail} more with smaller movement`)
  return lines.join("\n")
}

export default tool({
  description: `Cloud spend for a window compared against the window before it, broken down by service and sorted by what moved the most. The FinOps equivalent of k8s_diagnose: one call instead of hand-driving Cost Explorer. Every number comes from the billing API, so it's quotable to the customer.`,
  args: {
    days: tool.schema.number().describe("Window length in days, compared with the preceding equal window. Defaults to 30.").optional(),
    group_by: tool.schema.string().describe("SERVICE (default), LINKED_ACCOUNT, REGION, or USAGE_TYPE.").optional(),
    provider: tool.schema.enum(["aws", "gcp", "azure"]).describe("Which cloud. Omit to use whichever CLI is authenticated.").optional(),
  },
  async execute(args) {
    const days = args.days ?? 30
    const groupBy = (args.group_by || "SERVICE").toUpperCase()
    if (!VALID_GROUPS.has(groupBy)) return { title: "cost_diagnose", output: `Error: group_by must be one of ${[...VALID_GROUPS].sort().join(", ")}` }

    let provider = (args.provider || "").toLowerCase()
    let note = ""
    if (!PROVIDERS.includes(provider as any)) {
      if (provider === "gcp" || provider === "azure") {
        return { title: "cost_diagnose", output: `Error: ${provider} is not ported to box yet — only the AWS path has been carried over from naki-cli so far.` }
      }
      try {
        const [detected, why] = await detectProvider()
        provider = detected
        note = `(provider not given — read ${provider.toUpperCase()}, chosen from: ${why})\n\n`
      } catch (exc: any) {
        return { title: "cost_diagnose", output: `Error: ${exc.message}` }
      }
    }

    const [prevStart, prevEnd, curStart, curEnd] = monthWindows(days)
    try {
      const current = await fetchAws(curStart, curEnd, groupBy)
      const previous = await fetchAws(prevStart, prevEnd, groupBy)
      const header = `AWS cost, ${curStart} → ${curEnd} vs ${prevStart} → ${prevEnd}`
      return { title: "cost_diagnose", output: note + `${header}\n\n${renderComparison(current, previous, groupBy)}` }
    } catch (exc: any) {
      if (exc instanceof CloudError) return { title: "cost_diagnose", output: `Error: ${exc.message}` }
      throw exc
    }
  },
})
