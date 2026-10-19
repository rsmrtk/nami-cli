import { tool } from "@rsmrtk/plugin"
import { CloudError, runCli, money } from "./_shared/cloud"
import { PROVIDERS, detectProvider } from "./_shared/clouds"
import * as Patterns from "./_shared/patterns"

// Ported from naki-cli (naki/agent/tools/find_idle_resources.py) — AWS
// path only. GCP (Recommender projections) and Azure (Advisor + the
// stopped-vs-deallocated distinction) are each a real sub-system in naki
// that hasn't been ported; asking for them returns an explicit error.

const FALLBACK_PRICES = { gp3_gb_month: 0.08, eip_month: 3.6, alb_month: 16.2 }

async function prices(): Promise<[typeof FALLBACK_PRICES, string]> {
  let pattern: Patterns.Pattern | null = null
  try {
    pattern = await Patterns.get("aws-idle-classics")
  } catch {
    // a pack problem is reported, never fatal to a read-only sweep
  }
  if (!pattern) return [{ ...FALLBACK_PRICES }, "(prices: built-in defaults, no pattern pack found)"]
  try {
    return [
      {
        gp3_gb_month: Patterns.price(pattern, "gp3_gb_month"),
        eip_month: Patterns.price(pattern, "eip_month"),
        alb_month: Patterns.price(pattern, "alb_month"),
      },
      Patterns.caveat(pattern),
    ]
  } catch {
    return [{ ...FALLBACK_PRICES }, "(prices: built-in defaults, pattern pack incomplete)"]
  }
}

async function unattachedVolumes(scope: string[], p: typeof FALLBACK_PRICES): Promise<[string, number]> {
  const payload = await runCli(["aws", "ec2", "describe-volumes", "--filters", "Name=status,Values=available", "--output", "json", ...scope])
  const volumes = payload?.Volumes ?? []
  if (!volumes.length) return ["  none", 0]

  let total = 0
  const lines = volumes.slice(0, 20).map((v: any) => {
    const size = v.Size ?? 0
    const cost = size * p.gp3_gb_month
    total += cost
    return `  ${String(v.VolumeId ?? "?").padEnd(24)} ${String(size).padStart(5)} GiB  ~${money(cost)}/mo  created ${String(v.CreateTime ?? "?").slice(0, 10)}`
  })
  if (volumes.length > 20) lines.push(`  … and ${volumes.length - 20} more`)
  return [lines.join("\n"), total]
}

async function unassociatedIps(scope: string[], p: typeof FALLBACK_PRICES): Promise<[string, number]> {
  const payload = await runCli(["aws", "ec2", "describe-addresses", "--output", "json", ...scope])
  const idle = (payload?.Addresses ?? []).filter((a: any) => !a.AssociationId)
  if (!idle.length) return ["  none", 0]
  const lines = idle.slice(0, 20).map((a: any) => `  ${String(a.PublicIp ?? "?").padEnd(18)} allocation ${a.AllocationId ?? "?"}`)
  return [lines.join("\n"), idle.length * p.eip_month]
}

async function stoppedInstances(scope: string[], p: typeof FALLBACK_PRICES): Promise<[string, number]> {
  const payload = await runCli(["aws", "ec2", "describe-instances", "--filters", "Name=instance-state-name,Values=stopped", "--output", "json", ...scope])
  const instances = (payload?.Reservations ?? []).flatMap((r: any) => r.Instances ?? [])
  if (!instances.length) return ["  none", 0]

  let attachedGb = 0
  const lines = instances.slice(0, 20).map((i: any) => {
    const volumes = i.BlockDeviceMappings ?? []
    const name = (i.Tags ?? []).find((t: any) => t.Key === "Name")?.Value ?? ""
    attachedGb += volumes.length * 30
    return `  ${String(i.InstanceId ?? "?").padEnd(22)} ${String(i.InstanceType ?? "?").padEnd(14)} ${volumes.length} volume(s)  ${name}`
  })
  return [lines.join("\n"), attachedGb * p.gp3_gb_month]
}

async function emptyLoadBalancers(scope: string[], p: typeof FALLBACK_PRICES): Promise<[string, number]> {
  const payload = await runCli(["aws", "elbv2", "describe-load-balancers", "--output", "json", ...scope])
  const balancers = payload?.LoadBalancers ?? []
  if (!balancers.length) return ["  none", 0]

  const idle: any[] = []
  for (const balancer of balancers) {
    try {
      const groups = await runCli(["aws", "elbv2", "describe-target-groups", "--load-balancer-arn", balancer.LoadBalancerArn, "--output", "json", ...scope])
      if (!groups?.TargetGroups?.length) idle.push(balancer)
    } catch (exc) {
      if (exc instanceof CloudError) continue
      throw exc
    }
  }
  if (!idle.length) return ["  none", 0]
  const lines = idle.map((b) => `  ${String(b.LoadBalancerName ?? "?").padEnd(32)} ${b.Type ?? "?"}  ~${money(p.alb_month)}/mo`)
  return [lines.join("\n"), idle.length * p.alb_month]
}

export default tool({
  description: `Sweep a cloud account for the classics that quietly bill forever: unattached disks, reserved-but-unused IPs, stopped-yet-still-charged instances, load balancers with no targets. Returns what exists, never a guess that something might be idle.`,
  args: {
    provider: tool.schema.enum(["aws", "gcp", "azure"]).describe("Which cloud to sweep. Omit to use whichever CLI is authenticated.").optional(),
    region: tool.schema.string().describe("AWS region. Defaults to the CLI's configured region.").optional(),
    profile: tool.schema.string().describe("AWS profile, which is how a specific account is selected.").optional(),
  },
  async execute(args) {
    let provider = (args.provider || "").toLowerCase()
    let note = ""
    if (!PROVIDERS.includes(provider as any)) {
      if (provider === "gcp" || provider === "azure") {
        return { title: "find_idle_resources", output: `Error: ${provider} is not ported to box yet — only the AWS path has been carried over from naki-cli so far.` }
      }
      try {
        const [detected, why] = await detectProvider()
        provider = detected
        note = `(provider not given — swept ${provider.toUpperCase()}, chosen from: ${why})\n\n`
      } catch (exc: any) {
        return { title: "find_idle_resources", output: `Error: ${exc.message}` }
      }
    }

    const scope: string[] = []
    if (args.profile) scope.push("--profile", args.profile)
    if (args.region) scope.push("--region", args.region)

    const [p, caveat] = await prices()
    const sections: string[] = []
    let total = 0

    const checks: [string, (s: string[], p: typeof FALLBACK_PRICES) => Promise<[string, number]>][] = [
      ["unattached EBS volumes", unattachedVolumes],
      ["unassociated Elastic IPs", unassociatedIps],
      ["stopped instances (storage still billed)", stoppedInstances],
      ["load balancers with no target groups", emptyLoadBalancers],
    ]
    for (const [title, check] of checks) {
      try {
        const [body, cost] = await check(scope, p)
        total += cost
        const suffix = cost ? `  [~${money(cost)}/mo]` : ""
        sections.push(`=== ${title}${suffix} ===\n${body}`)
      } catch (exc: any) {
        if (exc instanceof CloudError) {
          sections.push(`=== ${title} ===\n  (skipped: ${exc.message})`)
        } else throw exc
      }
    }

    const footer = `\n\nRough recoverable: ~${money(total)}/mo at public on-demand rates. Confirm against the billing API (cost_diagnose) before quoting it. ${caveat}`
    return { title: "find_idle_resources", output: note + sections.join("\n\n") + footer }
  },
})
