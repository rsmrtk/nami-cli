import { tool } from "@rsmrtk/plugin"
import * as Cases from "./_shared/cases"

// Ported from naki-cli (naki/agent/tools/search_cases.py).

export default tool({
  description: `Search past FinOps cases: what was found on this kind of resource before, what was decided, and what the change actually did. Use it before proposing a saving.`,
  args: {
    query: tool.schema.string().describe("Keywords: pattern id, resource, namespace, tag.").optional(),
    limit: tool.schema.number().describe("Max cases to return. Defaults to 10.").optional(),
  },
  async execute(args) {
    const found = await Cases.search(args.query ?? "", process.cwd(), args.limit ?? 10)
    if (!found.length) {
      return {
        title: "search_cases",
        output: "No matching cases. The ledger is empty or nothing matches — either way this is not evidence that the change is new, only that nobody recorded trying it.",
      }
    }

    const totals = await Cases.totals()
    const header = `${found.length} case(s) — ledger holds ${totals.cases}: ${totals.measured} measured, ${totals.pending} pending measurement, ${totals.declined} declined`
    return { title: "search_cases", output: header + "\n\n" + found.map(Cases.summary).join("\n\n") }
  },
})
