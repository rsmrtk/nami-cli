// Ported from naki-cli (naki/agent/metrics_auth.py) — scoped down.
//
// Ported: `none` (a Prometheus reachable with no auth — the port-forwarded
// case, and the only one testable without cloud credentials) and `bearer`
// (a static token from NAKI_METRICS_TOKEN, read directly — box has no
// equivalent of naki's vault, so the value is read from the env var as-is
// rather than resolved through one).
//
// Not ported: AWS SigV4, GCP OAuth, Azure AAD. Each needs either a crypto
// implementation (SigV4: HMAC-SHA256 canonical requests) or a cloud CLI to
// shell out to (gcloud/az) that this environment has no account to verify
// against. `detect()` still recognises their hostnames so `describe()` can
// say "this looks like a managed endpoint, auth for it isn't wired up yet"
// instead of silently sending an unauthenticated request that will 401.

export const NONE = "none"
export const BEARER = "bearer"
export const AWS_SIGV4 = "aws-sigv4"
export const GCP = "gcp"
export const AZURE = "azure"

export function detect(url: string): string {
  let host = ""
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return NONE
  }
  if (host.startsWith("aps-workspaces.") && host.endsWith(".amazonaws.com")) return AWS_SIGV4
  if (host === "monitoring.googleapis.com") return GCP
  if (host.endsWith(".prometheus.monitor.azure.com")) return AZURE
  return NONE
}

export function modeFor(url: string, env = "NAKI_METRICS_AUTH"): string {
  const configured = (process.env[env] ?? process.env.NAKI_METRICS_AUTH ?? "").trim().toLowerCase()
  if (configured) return configured
  return detect(url)
}

export function headersFor(url: string, env = "NAKI_METRICS_AUTH"): Record<string, string> {
  const mode = modeFor(url, env)
  if (mode === "" || mode === NONE) return {}
  if (mode === BEARER) {
    const token = (process.env.NAKI_METRICS_TOKEN ?? "").trim()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
  // aws-sigv4/gcp/azure: not ported — fall through to no auth, same as naki
  // does when a configured mode's credentials can't be minted.
  return {}
}

export function describe(url: string): string {
  const mode = modeFor(url)
  if (mode === "" || mode === NONE) return "no authentication (a Prometheus reachable without it)"
  if (mode === BEARER) {
    const token = (process.env.NAKI_METRICS_TOKEN ?? "").trim()
    return "static bearer token" + (token ? "" : " — NAKI_METRICS_TOKEN is empty")
  }
  if (mode === AWS_SIGV4 || mode === GCP || mode === AZURE) {
    return `detected a managed endpoint (${mode}) but that auth mode isn't ported to box yet — requests go out unauthenticated and will likely 401`
  }
  return `unknown mode '${mode}'`
}

export async function requestJson(baseUrl: string, path: string, params: Record<string, string | number>, env = "NAKI_METRICS_AUTH") {
  const root = baseUrl.replace(/\/+$/, "")
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])))
  const url = `${root}${path}`
  const headers = headersFor(url, env)
  const response = await fetch(`${url}?${query}`, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => response.statusText)}`)
  return response.json()
}
