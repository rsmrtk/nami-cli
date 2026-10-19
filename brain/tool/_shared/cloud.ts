import { execFile } from "node:child_process"

// Ported from naki-cli (naki/agent/cloud.py). Shared plumbing for the
// FinOps tools: run a cloud CLI, parse its JSON, and turn the usual
// failure modes (not installed, not authenticated, API not enabled) into
// one clear sentence instead of a wall of stderr.

export class CloudError extends Error {}

function hasBinary(binary: string): Promise<boolean> {
  return new Promise((resolve) => execFile("which", [binary], (error) => resolve(!error)))
}

export async function runCli(cmd: string[], timeoutMs = 60_000): Promise<any> {
  const binary = cmd[0]!
  if (!(await hasBinary(binary))) throw new CloudError(`${binary} CLI is not installed on this machine.`)

  const { code, stdout, stderr, timedOut } = await new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    execFile(cmd[0]!, cmd.slice(1), { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as any).code ?? 1) : 0, stdout, stderr, timedOut: Boolean(error && (error as any).killed) })
    })
  })

  if (timedOut) throw new CloudError(`${binary} timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd.slice(0, 4).join(" ")}…`)

  if (code !== 0) {
    const stderrText = (stderr || "").trim()
    const lowered = stderrText.toLowerCase()
    if (lowered.includes("not enabled on project") || lowered.includes("has not been used in project")) {
      const api = stderrText.replace(/[[\]]/g, " ").split(/\s+/).find((t) => t.endsWith(".googleapis.com")) ?? "this API"
      throw new CloudError(`${api} is not enabled on the project — enable it, or pick a project that has it.`)
    }
    if (lowered.includes("az login") || lowered.includes("run 'az login'")) {
      throw new CloudError("Azure CLI is not signed in — run `az login` first.")
    }
    if (lowered.includes("credential") || lowered.includes("expired") || lowered.includes("not logged in")) {
      throw new CloudError(`${binary} is not authenticated — run its login first. (${stderrText.split("\n")[0]})`)
    }
    if (lowered.replace(/\s/g, "").includes("accessdenied") || lowered.includes("not authorized")) {
      throw new CloudError(`${binary} lacks permission for this call: ${stderrText.split("\n")[0]}`)
    }
    const readable = readableCliError(stderrText) || `exit ${code}`
    throw new CloudError(`${binary} call failed: ${readable}`)
  }

  if (!stdout.trim()) return {}
  try {
    return JSON.parse(stdout)
  } catch {
    throw new CloudError(`${binary} returned output that isn't JSON — got: ${stdout.slice(0, 200)}`)
  }
}

export function readableCliError(stderr: string): string {
  const text = (stderr || "").trim()
  if (!text) return ""
  const lowered = text.toLowerCase()
  if (
    lowered.includes("couldn't get current server api group list") ||
    (lowered.includes("connection refused") && lowered.includes("kubectl")) ||
    lowered.includes("was refused - did you specify the right host or port") ||
    (lowered.includes("dial tcp") && lowered.includes("i/o timeout"))
  ) {
    return "the cluster is not reachable — the API server did not answer. Check which context the kubeconfig points at and whether the cluster is running."
  }
  if (lowered.includes("the connection to the server") && lowered.includes("refused")) {
    return "the cluster is not reachable — the API server refused the connection."
  }
  if (lowered.includes("you must be logged in to the server") || lowered.includes("unauthorized")) {
    return "the cluster rejected these credentials — the kubeconfig token may have expired."
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !/^[EWIF]\d{4}\s/.test(trimmed)) return trimmed
  }
  return text.split("\n")[0]!
}

export function monthWindows(days = 30): [string, string, string, string] {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  const currentStart = new Date(today)
  currentStart.setUTCDate(currentStart.getUTCDate() - days)
  const prevStart = new Date(currentStart)
  prevStart.setUTCDate(prevStart.getUTCDate() - days)
  return [iso(prevStart), iso(currentStart), iso(currentStart), iso(today)]
}

export function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDelta(current: number, previous: number): string {
  const delta = current - previous
  const pct = previous === 0 ? (delta ? "new" : "flat") : `${delta >= 0 ? "+" : ""}${((delta / previous) * 100).toFixed(0)}%`
  return `${money(current)} (${money(delta)} ${pct} vs previous)`
}
