import { CloudError, runCli } from "./cloud"

// Ported from naki-cli (naki/agent/clouds.py) — scoped to AWS.
//
// naki detects whichever of AWS/GCP/Azure is usable and refuses to guess
// when more than one is. This port only has the AWS probe: GCP (gcp.py —
// BigQuery billing-export queries) and Azure (azure.py — Cost Management
// API + `az consumption` record parsing) are each a module of their own
// that hasn't been ported. Rather than pretend to detect three clouds and
// silently misreport two of them, `usable()` here only ever finds AWS, and
// callers that pass provider=gcp/azure get an explicit "not ported" error
// instead of a result built on logic that was never written.
export const PROVIDERS = ["aws"] as const

async function probeAws(): Promise<string> {
  const identity = await runCli(["aws", "sts", "get-caller-identity", "--output", "json"])
  const account = typeof identity === "object" && identity ? identity.Account ?? "?" : "?"
  return `authenticated aws CLI (account ${account})`
}

export async function usable(): Promise<Record<string, string>> {
  try {
    return { aws: await probeAws() }
  } catch {
    return {}
  }
}

export async function detectProvider(): Promise<[string, string]> {
  const found = await usable()
  const entries = Object.entries(found)
  if (entries.length === 1) return entries[0]!
  throw new CloudError("no cloud is usable from here — the aws CLI is not authenticated. (GCP and Azure detection are not ported to box yet — pass provider explicitly if you meant one of those.)")
}
