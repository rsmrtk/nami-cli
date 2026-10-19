import { tool } from "@rsmrtk/plugin"
import { CloudError, runCli, money } from "./_shared/cloud"
import { PROVIDERS, detectProvider } from "./_shared/clouds"
import * as Patterns from "./_shared/patterns"

// Ported from naki-cli (naki/agent/tools/cost_anomaly_scan.py) — AWS path
// only, same scope cut as cost_diagnose: GCP/Azure daily-spend series need
// modules (gcp.py, azure.py) that haven't been ported.

const FALLBACK_MULTIPLE = 1.4

async function medianMultiple(): Promise<[number, string]> {
  try {
    const pattern = await Patterns.get("cost-anomaly-median")
    if (pattern) return [Patterns.threshold(pattern, "median_multiple"), Patterns.caveat(pattern)]
  } catch {
    // fall through
  }
  return [FALLBACK_MULTIPLE, "(threshold: built-in default, no pattern pack found)"]
}

async function flagSpikes(series: [string, number][], threshold?: number): Promise<string> {
  let caveat = ""
  if (threshold === undefined) [threshold, caveat] = await medianMultiple()
  if (!series.length) return "(no daily cost data returned)"

  const values = series.map(([, v]) => v).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2

  const lines: string[] = []
  let spikes = 0
  for (const [day, value] of series) {
    let marker = ""
    if (median && value > median * threshold) {
      marker = `  ← ${(value / median).toFixed(1)}× median`
      spikes++
    }
    lines.push(`  ${day}  ${money(value).padStart(12)}${marker}`)
  }

  const header = median ? `median day: ${money(median)} | ${spikes} day(s) above ${threshold}× median ${caveat}`.trimEnd() : "median day: n/a"
  return `${header}\n` + lines.join("\n")
}

async function dailySeriesAws(start: string, end: string): Promise<[string, number][]> {
  const payload = await runCli([
    "aws", "ce", "get-cost-and-usage",
    "--time-period", `Start=${start},End=${end}`,
    "--granularity", "DAILY", "--metrics", "UnblendedCost", "--output", "json",
  ])
  const series: [string, number][] = []
  for (const period of payload?.ResultsByTime ?? []) {
    const day = period.TimePeriod?.Start ?? "?"
    const amount = parseFloat(period.Total?.UnblendedCost?.Amount ?? "0")
    if (Number.isFinite(amount)) series.push([day, amount])
  }
  return series
}

async function anomaliesAws(start: string, end: string): Promise<string> {
  const payload = await runCli(["aws", "ce", "get-anomalies", "--date-interval", `StartDate=${start},EndDate=${end}`, "--output", "json"])
  const anomalies = payload?.Anomalies ?? []
  if (!anomalies.length) return "  none reported by AWS Cost Anomaly Detection"

  return anomalies
    .slice(0, 10)
    .map((anomaly: any) => {
      const impact = anomaly.Impact ?? {}
      const total = Number.isFinite(parseFloat(impact.TotalImpact)) ? money(parseFloat(impact.TotalImpact)) : "?"
      const root = anomaly.RootCauses?.[0]
      const cause = root ? [root.Service, root.Region, root.UsageType].filter(Boolean).join(", ") : "(no root cause attributed)"
      return `  ${anomaly.AnomalyStartDate ?? "?"} → ${anomaly.AnomalyEndDate ?? "ongoing"}  impact ${total}  ${cause}`
    })
    .join("\n")
}

export default tool({
  description: `Find spend spikes: AWS Cost Anomaly Detection findings plus a day-by-day series with the outlier days flagged. When a spike shows up, follow it with deploy_timeline for the same hours — a spike that starts right after a deploy is usually the same incident wearing a different hat.`,
  args: {
    days: tool.schema.number().describe("Lookback window in days. Defaults to 30.").optional(),
    provider: tool.schema.enum(["aws", "gcp", "azure"]).describe("Which cloud. Omit to use whichever CLI is authenticated.").optional(),
  },
  async execute(args) {
    const days = args.days ?? 30
    const end = new Date()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - days)
    const startS = start.toISOString().slice(0, 10)
    const endS = end.toISOString().slice(0, 10)

    let provider = (args.provider || "").toLowerCase()
    let note = ""
    if (!PROVIDERS.includes(provider as any)) {
      if (provider === "gcp" || provider === "azure") {
        return { title: "cost_anomaly_scan", output: `Error: ${provider} is not ported to box yet — only the AWS path has been carried over from naki-cli so far.` }
      }
      try {
        const [detected, why] = await detectProvider()
        provider = detected
        note = `(provider not given — read ${provider.toUpperCase()}, chosen from: ${why})\n\n`
      } catch (exc: any) {
        return { title: "cost_anomaly_scan", output: `Error: ${exc.message}` }
      }
    }

    const sections: string[] = []
    for (const [title, check] of [
      ["AWS Cost Anomaly Detection findings", () => anomaliesAws(startS, endS)],
      ["daily spend", async () => flagSpikes(await dailySeriesAws(startS, endS))],
    ] as const) {
      try {
        sections.push(`=== ${title} ===\n${await check()}`)
      } catch (exc: any) {
        if (exc instanceof CloudError) {
          sections.push(`=== ${title} ===\n  (skipped: ${exc.message})`)
        } else throw exc
      }
    }

    const footer = "\n\nNext step for any flagged day: deploy_timeline for that date, and metric_query on the affected service — a cost spike with a deploy in the same hour is one event, not two."
    return { title: "cost_anomaly_scan", output: note + `Cost anomalies, ${startS} → ${endS}\n\n${sections.join("\n\n")}${footer}` }
  },
})
