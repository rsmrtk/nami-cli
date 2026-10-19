import { tool } from "@rsmrtk/plugin"
import { settings } from "./_shared/settings"
import { parseDuration, summarizeSeries, noPrometheusError, queryRange } from "./_shared/prometheus"

// Ported from naki-cli (naki/agent/tools/metric_query.py).

export default tool({
  description: `Run a PromQL query against the configured Prometheus-compatible endpoint and get the timeseries back, downsampled to readable points. Use it to find the exact moment a metric started deviating — 'it got slow recently' is not a root cause, 'p99 tripled at 14:12, four minutes after the deploy' is.`,
  args: {
    query: tool.schema.string().describe("PromQL expression."),
    duration: tool.schema.string().describe("Lookback window: '1h', '6h', '24h'. Defaults to '1h'.").optional(),
  },
  async execute(args) {
    if (!settings.prometheusUrl) return { title: args.query, output: noPrometheusError() }

    const durationText = args.duration || "1h"
    const seconds = parseDuration(durationText)
    const end = Date.now() / 1000
    const start = end - seconds
    const step = Math.max(Math.floor(seconds / 200), 15)

    const { result, error } = await queryRange(args.query, start, end, step)
    if (error) return { title: args.query, output: error }

    return {
      title: args.query,
      output: `query: ${args.query} (last ${durationText})\n${summarizeSeries(result!)}`,
    }
  },
})
