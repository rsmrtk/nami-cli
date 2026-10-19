import { tool } from "@rsmrtk/plugin"
import { CloudError, runCli, money, monthWindows } from "./_shared/cloud"
import { PROVIDERS, detectProvider } from "./_shared/clouds"

// Ported from naki-cli (naki/agent/tools/commitment_coverage.py) — AWS
// path only. GCP (Committed Use Discounts + Recommender) and Azure
// (Reservations + Advisor) each need their own module that isn't ported.

function pct(value: unknown): number {
  const v = parseFloat(String(value))
  return Number.isFinite(v) ? v : 0
}

async function reservationCoverage(start: string, end: string): Promise<string> {
  const payload = await runCli(["aws", "ce", "get-reservation-coverage", "--time-period", `Start=${start},End=${end}`, "--output", "json"])
  const hours = payload?.Total?.CoverageHours ?? {}
  const covered = pct(hours.CoverageHoursPercentage)
  const onDemand = hours.OnDemandHours ?? "0"
  return `  RI coverage: ${covered.toFixed(1)}% of eligible hours\n  on-demand hours left uncovered: ${onDemand}`
}

async function savingsPlansCoverage(start: string, end: string): Promise<string> {
  const payload = await runCli(["aws", "ce", "get-savings-plans-coverage", "--time-period", `Start=${start},End=${end}`, "--output", "json"])
  const entries = payload?.SavingsPlansCoverages ?? []
  if (!entries.length) return "  Savings Plans: no coverage data returned"

  const coverage = entries[0].Coverage ?? {}
  const p = pct(coverage.CoveragePercentage)
  const onDemand = parseFloat(coverage.OnDemandCost ?? "0")
  const onDemandValue = Number.isFinite(onDemand) ? money(onDemand) : String(coverage.OnDemandCost)
  return `  Savings Plans coverage: ${p.toFixed(1)}%\n  spend still at on-demand: ${onDemandValue}`
}

async function utilization(start: string, end: string): Promise<string> {
  const payload = await runCli(["aws", "ce", "get-savings-plans-utilization", "--time-period", `Start=${start},End=${end}`, "--output", "json"])
  const used = pct(payload?.Total?.Utilization?.UtilizationPercentage)
  if (!used) return "  Savings Plans utilization: no active commitments"
  return `  Savings Plans utilization: ${used.toFixed(1)}% (under 100% means you're paying for unused commitment)`
}

export default tool({
  description: `How much steady-state usage is running at on-demand rates instead of under a Reserved Instance or Savings Plan, plus current utilization of what's already committed. This is money leaking quietly every month — predictable load paying the unpredictable price.`,
  args: {
    days: tool.schema.number().describe("Lookback window in days. Defaults to 30.").optional(),
    provider: tool.schema.enum(["aws", "gcp", "azure"]).describe("Which cloud. Omit to use whichever CLI is authenticated.").optional(),
  },
  async execute(args) {
    const days = args.days ?? 30
    const [, , start, end] = monthWindows(days)

    let provider = (args.provider || "").toLowerCase()
    let note = ""
    if (!PROVIDERS.includes(provider as any)) {
      if (provider === "gcp" || provider === "azure") {
        return { title: "commitment_coverage", output: `Error: ${provider} is not ported to box yet — only the AWS path has been carried over from naki-cli so far.` }
      }
      try {
        const [detected, why] = await detectProvider()
        provider = detected
        note = `(provider not given — checked ${provider.toUpperCase()}, chosen from: ${why})\n\n`
      } catch (exc: any) {
        return { title: "commitment_coverage", output: `Error: ${exc.message}` }
      }
    }

    const sections: string[] = []
    const checks: [string, () => Promise<string>][] = [
      ["Reserved Instances", () => reservationCoverage(start, end)],
      ["Savings Plans coverage", () => savingsPlansCoverage(start, end)],
      ["Savings Plans utilization", () => utilization(start, end)],
    ]
    for (const [title, check] of checks) {
      try {
        sections.push(`=== ${title} ===\n${await check()}`)
      } catch (exc: any) {
        if (exc instanceof CloudError) {
          sections.push(`=== ${title} ===\n  (skipped: ${exc.message})`)
        } else throw exc
      }
    }

    const header = `Commitment coverage, ${start} → ${end}`
    const footer = "\n\nLow coverage on steady workloads is the gap worth closing; low utilization means existing commitments are oversized. Both are quotable from this data."
    return { title: "commitment_coverage", output: note + `${header}\n\n${sections.join("\n\n")}${footer}` }
  },
})
