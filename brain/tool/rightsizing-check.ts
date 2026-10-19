import { tool } from "@rsmrtk/plugin"
import { CloudError, runCli, money } from "./_shared/cloud"
import { PROVIDERS, detectProvider } from "./_shared/clouds"

// Ported from naki-cli (naki/agent/tools/rightsizing_check.py) — AWS path
// only (Compute Optimizer). GCP's machine-type/Cloud SQL Recommender and
// Azure Advisor's sizing section are not ported.

function savingsOf(recommendation: any): number {
  const options = recommendation.recommendationOptions ?? []
  let best = 0
  for (const option of options) {
    const value = parseFloat(option.savingsOpportunity?.estimatedMonthlySavings?.value)
    if (Number.isFinite(value)) best = Math.max(best, value)
  }
  return best
}

function renderRecommendations(recommendations: any[], finding: string): string {
  const matching = recommendations.filter((r) => String(r.finding ?? "").toUpperCase() === finding)
  if (!matching.length) return `(no instances currently marked ${finding})`

  matching.sort((a, b) => savingsOf(b) - savingsOf(a))
  const lines: string[] = []
  let total = 0
  for (const rec of matching.slice(0, 20)) {
    const saving = savingsOf(rec)
    total += saving
    const options = rec.recommendationOptions ?? []
    const target = options[0]?.instanceType ?? "?"
    const name = rec.instanceName || String(rec.instanceArn ?? "?").split("/").pop()
    lines.push(`  ${String(name).padEnd(28)} ${String(rec.currentInstanceType ?? "?").padEnd(14)} → ${String(target).padEnd(14)} ~${money(saving)}/mo`)
  }
  if (matching.length > 20) lines.push(`  … and ${matching.length - 20} more`)

  return `${matching.length} instance(s) marked ${finding}\n${lines.join("\n")}\n\nEstimated total: ~${money(total)}/mo from these recommendations.`
}

export default tool({
  description: `AWS Compute Optimizer's rightsizing findings: which instances are over-provisioned for their actual measured utilization, and what the recommended size would save. Utilization-backed, so the saving is defensible rather than a hunch about instance sizes.`,
  args: {
    finding: tool.schema.string().describe("Filter: OVER_PROVISIONED (default), UNDER_PROVISIONED, or OPTIMIZED.").optional(),
    region: tool.schema.string().describe("AWS region. Defaults to the CLI's configured region.").optional(),
    provider: tool.schema.enum(["aws", "gcp", "azure"]).describe("Which cloud. Omit to use whichever CLI is authenticated.").optional(),
  },
  async execute(args) {
    const finding = (args.finding || "OVER_PROVISIONED").toUpperCase()

    let provider = (args.provider || "").toLowerCase()
    let note = ""
    if (!PROVIDERS.includes(provider as any)) {
      if (provider === "gcp" || provider === "azure") {
        return { title: "rightsizing_check", output: `Error: ${provider} is not ported to box yet — only the AWS path has been carried over from naki-cli so far.` }
      }
      try {
        const [detected, why] = await detectProvider()
        provider = detected
        note = `(provider not given — checked ${provider.toUpperCase()}, chosen from: ${why})\n\n`
      } catch (exc: any) {
        return { title: "rightsizing_check", output: `Error: ${exc.message}` }
      }
    }

    const cmd = ["aws", "compute-optimizer", "get-ec2-instance-recommendations", "--output", "json"]
    if (args.region) cmd.push("--region", args.region)

    let payload: any
    try {
      payload = await runCli(cmd)
    } catch (exc: any) {
      let message = exc instanceof CloudError ? exc.message : String(exc.message ?? exc)
      if (message.toLowerCase().includes("opt") && message.toLowerCase().includes("in")) {
        message += " — Compute Optimizer has to be opted into per account before it returns findings."
      }
      return { title: "rightsizing_check", output: `Error: ${message}` }
    }

    const recommendations = payload?.instanceRecommendations ?? []
    return { title: "rightsizing_check", output: note + renderRecommendations(recommendations, finding) }
  },
})
