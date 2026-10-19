import { requestJson, describe as describeAuth } from "./metrics-auth"
import { settings } from "./settings"

// Ported from naki-cli (naki/agent/tools/metric_query.py + slo_status.py).

const UNITS: Record<string, number> = { m: 60, h: 3600, d: 86400 }

export function parseDuration(text: string | undefined): number {
  const trimmed = (text ?? "").trim().toLowerCase()
  if (!trimmed) return 3600
  const unit = trimmed.slice(-1)
  if (unit in UNITS) {
    const value = parseFloat(trimmed.slice(0, -1))
    return Number.isFinite(value) ? Math.trunc(value * UNITS[unit]!) : 3600
  }
  const value = parseFloat(trimmed)
  return Number.isFinite(value) ? Math.trunc(value) : 3600
}

export function summarizeSeries(result: any[], maxPoints = 20): string {
  if (!result?.length) return "(query returned no series)"

  const lines: string[] = []
  for (const series of result.slice(0, 5)) {
    const labels = series.metric ?? {}
    const name = labels.__name__ ?? ""
    const labelBits = Object.entries(labels)
      .filter(([k]) => k !== "__name__")
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    const header = labelBits ? `${name}{${labelBits}}` : name || "(unlabeled series)"

    const values: [string, string][] = series.values ?? []
    if (!values.length) {
      lines.push(`${header}: (no points)`)
      continue
    }

    const numeric = values
      .map(([ts, raw]) => [parseFloat(ts), parseFloat(raw)] as [number, number])
      .filter(([ts, v]) => Number.isFinite(ts) && Number.isFinite(v))

    if (!numeric.length) {
      lines.push(`${header}: (no numeric points)`)
      continue
    }

    const step = Math.max(Math.floor(numeric.length / maxPoints), 1)
    const sampled = numeric.filter((_, i) => i % step === 0).slice(0, maxPoints)
    const lowest = numeric.reduce((a, b) => (b[1] < a[1] ? b : a))
    const highest = numeric.reduce((a, b) => (b[1] > a[1] ? b : a))

    const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const points = sampled.map(([ts, v]) => `${fmtTime(ts)}=${v}`).join("  ")

    lines.push(
      `${header}\n` +
        `  ${numeric.length} points | min ${lowest[1]} at ${fmtTime(lowest[0])} | max ${highest[1]} at ${fmtTime(highest[0])}\n` +
        `  ${points}`,
    )
  }
  if (result.length > 5) lines.push(`... and ${result.length - 5} more series (narrow the query)`)
  return lines.join("\n")
}

export function noPrometheusError(): string {
  return "Error: no Prometheus endpoint configured. Set NAKI_PROMETHEUS_URL (e.g. http://localhost:9090) and try again."
}

export async function queryRange(query: string, start: number, end: number, step: number): Promise<{ result: any[] | null; error: string }> {
  try {
    const payload: any = await requestJson(settings.prometheusUrl, "/api/v1/query_range", { query, start, end, step })
    if (payload.status !== "success") return { result: null, error: `Prometheus rejected the query: ${payload.error ?? "unknown error"}` }
    return { result: payload.data?.result ?? [], error: "" }
  } catch (exc: any) {
    return {
      result: null,
      error: `Error querying Prometheus at ${settings.prometheusUrl}: ${exc.message} [auth: ${describeAuth(settings.prometheusUrl)}]`,
    }
  }
}

// Public name mirrors naki's own `instant` alias — a single scalar from
// Prometheus, (value, problem).
export async function instant(query: string): Promise<[number | null, string]> {
  let payload: any
  try {
    payload = await requestJson(settings.prometheusUrl, "/api/v1/query", { query })
  } catch (exc: any) {
    return [null, `Prometheus request failed: ${exc.message} [auth: ${describeAuth(settings.prometheusUrl)}]`]
  }
  if (payload.status !== "success") return [null, `Prometheus rejected the query: ${payload.error ?? "unknown error"}`]
  const result = payload.data?.result ?? []
  if (!result.length) return [null, "the query matched no series — check the metric names and labels"]
  const value = parseFloat(result[0]?.value?.[1])
  return Number.isFinite(value) ? [value, ""] : [null, "Prometheus returned a value that isn't a number"]
}
