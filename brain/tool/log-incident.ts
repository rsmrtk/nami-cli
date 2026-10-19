import { tool } from "@rsmrtk/plugin"
import * as Incidents from "./_shared/incidents"

// Ported from naki-cli (naki/agent/tools/log_incident.py). Local journal
// only — see _shared/incidents.ts for the shared-backend scope cut.

export default tool({
  description: `Record a finished investigation in the team's incident journal so future investigations can find it. Log it once the root cause is actually established — write what you verified, leave a field empty rather than filling it with a guess.`,
  args: {
    title: tool.schema.string().describe("Short title, e.g. 'checkout 5xx after v2.41'."),
    service: tool.schema.string().describe("Service or component affected.").optional(),
    symptom: tool.schema.string().describe("What was observed, in the words someone would search for later.").optional(),
    root_cause: tool.schema.string().describe("The established cause.").optional(),
    resolution: tool.schema.string().describe("What resolved it.").optional(),
    related_change: tool.schema.string().describe("Deploy, commit or PR it traced back to.").optional(),
    tags: tool.schema.array(tool.schema.string()).optional(),
    distinct_because: tool.schema
      .string()
      .describe("Only needed when naki says this looks like an incident already logged: what makes this one a separate event.")
      .optional(),
  },
  async execute(args) {
    const candidate: Incidents.Incident = {
      title: args.title || "Untitled incident",
      service: args.service ?? "",
      symptom: args.symptom ?? "",
      root_cause: args.root_cause ?? "",
      resolution: args.resolution ?? "",
      related_change: args.related_change ?? "",
      tags: args.tags ?? [],
      logged_at: "",
    }

    const distinct = (args.distinct_because ?? "").trim()
    if (!distinct) {
      const existing = await Incidents.similarRecent(candidate)
      if (existing) {
        return {
          title: candidate.title,
          output:
            `Not written: this looks like the incident already logged at ${existing.logged_at} — '${existing.title}'` +
            (existing.service ? ` (${existing.service})` : "") +
            ". One event belongs in the journal once, or the history stops being readable. If this really is a separate event, call log_incident again with distinct_because saying what makes it different — and if it is the same one, add what you learned to the existing entry instead.",
        }
      }
    }
    if (distinct) candidate.symptom = (candidate.symptom + `\n[distinct from an earlier entry: ${distinct}]`).trim()

    const incident = await Incidents.log(candidate)
    return { title: incident.title, output: `Logged to the incident journal:\n${Incidents.summary(incident)}` }
  },
})
