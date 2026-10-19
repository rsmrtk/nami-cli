import { tool } from "@rsmrtk/plugin"
import * as Incidents from "./_shared/incidents"

// Ported from naki-cli (naki/agent/tools/search_incident_history.py).
// Local journal only — the shared-backend merge step is dropped along
// with the rest of naki.backend.client (see _shared/incidents.ts).

export default tool({
  description: `Search this team's own past incidents — symptoms, root causes, how each was resolved. Check it early in any investigation: if the same symptom has been seen before, the previous root cause is the strongest lead there is. Returns nothing rather than a guess when the history has no match.`,
  args: {
    query: tool.schema.string().describe("Symptom, service or keywords, e.g. 'checkout 5xx connection pool'."),
    limit: tool.schema.number().describe("Max results. Defaults to 10.").optional(),
  },
  async execute(args) {
    const limit = args.limit ?? 10
    const matches = await Incidents.search(args.query, process.cwd(), limit)

    if (!matches.length) {
      const all = await Incidents.allIncidents()
      if (!all.length) {
        return {
          title: "search_incident_history",
          output: "The incident journal is empty — nothing has been logged yet. Use log_incident after an investigation so the next one starts from what was already learned.",
        }
      }
      return { title: "search_incident_history", output: `No past incident matches '${args.query}'. This appears to be new.` }
    }

    const header = `${matches.length} past incident(s) matching '${args.query}':`
    return { title: "search_incident_history", output: header + "\n\n" + matches.map(Incidents.summary).join("\n\n") }
  },
})
