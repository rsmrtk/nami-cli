import { tool } from "@rsmrtk/plugin"
import { settings } from "./_shared/settings"
import { noPrometheusError } from "./_shared/prometheus"
import { load, measure, describe, SLO_PATH } from "./_shared/slo"

// Ported from naki-cli (naki/agent/tools/slo_status.py).

export default tool({
  description: `Error budget status for the team's declared SLOs, measured from Prometheus: current SLI, how much of the budget this window has consumed, multi-window burn rates, and which burn-rate alert would be firing. This is the number that decides ship-or-freeze and page-or-wait, so use it before advising either. Reads objectives from .naki/slos.yaml and never invents one for a service that has none.`,
  args: {
    name: tool.schema.string().describe("One SLO to report on. Omit for all of them.").optional(),
  },
  async execute(args) {
    if (!settings.prometheusUrl) return { title: "slo_status", output: noPrometheusError() }

    const { slos, problems } = await load()
    if (!Object.keys(slos).length) {
      const detail = problems.map((p) => `  ! ${p}`).join("\n")
      return {
        title: "slo_status",
        output:
          `No SLOs defined. Write them to ${SLO_PATH} so naki measures what the team actually committed to, rather than a number it made up:\n\n` +
          `slos:\n  checkout-availability:\n    objective: 99.9\n    window: 30d\n` +
          `    good: 'sum(rate(http_requests_total{job="checkout",code!~"5.."}[5m]))'\n` +
          `    total: 'sum(rate(http_requests_total{job="checkout"}[5m]))'` +
          (detail ? `\n\n${detail}` : ""),
      }
    }

    let selected: ReturnType<typeof Object.values<typeof slos[string]>>
    if (args.name) {
      const definition = slos[args.name]
      if (!definition) {
        return { title: args.name, output: `Error: no SLO named '${args.name}'. Defined: ${Object.keys(slos).sort().join(", ")}` }
      }
      selected = [definition]
    } else {
      selected = Object.keys(slos).sort().map((n) => slos[n]!)
    }

    const sections = await Promise.all(selected.map(async (definition) => describe(await measure(definition))))
    if (problems.length) sections.push(problems.map((p) => `! ${p}`).join("\n"))
    return { title: args.name ?? "all SLOs", output: sections.join("\n\n") }
  },
})
