import { tool } from "@rsmrtk/plugin"
import { settings } from "./_shared/settings"
import { parseDuration } from "./_shared/prometheus"
import { requestJson, describe as describeAuth } from "./_shared/metrics-auth"

// Ported from naki-cli (naki/agent/tools/log_query.py).

const NOISE_LABELS = new Set(["filename", "job", "service_name", "detected_level"])

function streamName(labels: Record<string, string>): string {
  const parts: string[] = []
  for (const key of ["namespace", "pod", "container"]) if (labels[key]) parts.push(labels[key]!)
  let name = parts.join("/") || "?"
  const extra = Object.entries(labels).filter(([k]) => !NOISE_LABELS.has(k) && !["namespace", "pod", "container", "stream"].includes(k))
  if (extra.length) name += " " + extra.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",")
  return name
}

function summarizeStreams(streams: any[], limit: number): string {
  if (!streams.length) return "(no matching log lines)"

  type Entry = [string, number, Record<string, string>, string]
  const entries: Entry[] = []
  streams.forEach((stream, index) => {
    const labels = stream.stream ?? {}
    for (const [ts, line] of stream.values ?? []) entries.push([String(ts), index, labels, line])
  })
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const total = entries.length
  const shown = entries.slice(-limit)

  const out = [`${total} matching lines` + (total > shown.length ? `, showing last ${shown.length}` : "")]
  let current: number | null = null
  for (const [ts, index, labels, line] of shown) {
    if (index !== current) {
      current = index
      const marker = labels.stream
      out.push(`— ${streamName(labels)}${marker ? ` (${marker})` : ""}`)
    }
    const nsTs = parseInt(ts, 10)
    const when = Number.isFinite(nsTs) ? new Date(nsTs / 1e6).toLocaleTimeString([], { hour12: false }) : "?"
    out.push(`  ${when}  ${line}`)
  }
  return out.join("\n")
}

async function whyThereIsNothing(): Promise<string> {
  let payload: any
  try {
    payload = await requestJson(settings.lokiUrl, "/loki/api/v1/labels", {}, "NAKI_LOGS_AUTH")
  } catch {
    return ""
  }
  const labels: string[] = payload?.data ?? []
  if (!labels.length) {
    return (
      "\n[naki] This Loki holds no log streams at all — not for this query, not for anything. " +
      "Nothing is shipping logs to it (no promtail/alloy/fluent-bit, or it cannot reach Loki). " +
      "An empty result here is not evidence that the service was quiet."
    )
  }
  if (!labels.includes("namespace") && !labels.includes("pod")) {
    return `\n[naki] This Loki has streams but no Kubernetes labels (${[...labels].sort().slice(0, 8).join(", ")}), so a query written against namespace or pod cannot match anything here.`
  }
  return ""
}

export default tool({
  description: `Search aggregated logs (Loki-compatible, LogQL) across services, not just one pod the way kubectl logs does. Use it when the failure is wider than a single container, or when the pod that failed is already gone.`,
  args: {
    query: tool.schema.string().describe('LogQL selector, e.g. \'{app="checkout"} |= "error"\'.'),
    duration: tool.schema.string().describe("Lookback window: '15m', '1h', '6h'. Defaults to '1h'.").optional(),
    limit: tool.schema.number().describe("Max log lines to return. Defaults to 100.").optional(),
  },
  async execute(args) {
    if (!settings.lokiUrl) return { title: args.query, output: "Error: no Loki endpoint configured. Set NAKI_LOKI_URL (e.g. http://localhost:3100) and try again." }

    const limit = args.limit ?? 100
    const durationText = args.duration || "1h"
    const seconds = parseDuration(durationText)
    const end = Date.now() / 1000
    const start = end - seconds

    let payload: any
    try {
      payload = await requestJson(
        settings.lokiUrl,
        "/loki/api/v1/query_range",
        { query: args.query, start: Math.trunc(start * 1e9), end: Math.trunc(end * 1e9), limit, direction: "backward" },
        "NAKI_LOGS_AUTH",
      )
    } catch (exc: any) {
      return { title: args.query, output: `Error querying Loki at ${settings.lokiUrl}: ${exc.message} [auth: ${describeAuth(settings.lokiUrl)}]` }
    }

    const streams = payload.data?.result ?? []
    let body = summarizeStreams(streams, limit)
    if (!streams.length) body += await whyThereIsNothing()
    return { title: args.query, output: `query: ${args.query} (last ${durationText})\n${body}` }
  },
})
