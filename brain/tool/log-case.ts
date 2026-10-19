import { tool } from "@rsmrtk/plugin"
import * as Cases from "./_shared/cases"

// Ported from naki-cli (naki/agent/tools/log_case.py). Local ledger only.

export default tool({
  description: `Record a FinOps finding and what was decided about it, so the effect can be measured later instead of estimated. Log the finding when it is made; log it again with baseline/after amounts once the measurement window has closed. Leave amounts empty rather than guessing.`,
  args: {
    pattern: tool.schema.string().describe("Pattern id from the pack, e.g. k8s-over-request."),
    resource: tool.schema.string().describe("The resource itself: cluster/namespace/workload, disk name, instance id."),
    finding: tool.schema.string().describe("What was observed, with the evidence — the numbers, not the adjective."),
    recommendation: tool.schema.string().describe("What was proposed.").optional(),
    source: tool.schema.string().describe("Where the numbers came from: recommender, billing-export, opencost, prometheus.").optional(),
    decision: tool.schema.enum(["approved", "declined", "deferred"]).describe("What the human decided, if they have.").optional(),
    decided_by: tool.schema.string().optional(),
    baseline_amount: tool.schema.number().describe("Measured spend before the change.").optional(),
    after_amount: tool.schema.number().describe("Measured spend after the window closed.").optional(),
    currency: tool.schema.string().optional(),
    measure_window_days: tool.schema.number().optional(),
    confounders: tool.schema.array(tool.schema.string()).describe("Other changes in the same window, from deploy_timeline.").optional(),
    confounders_checked: tool.schema.boolean().describe("True only if deploy_timeline was actually run for the window.").optional(),
    tags: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args) {
    const c = await Cases.log({
      pattern: args.pattern ?? "",
      resource: args.resource ?? "",
      finding: args.finding ?? "",
      recommendation: args.recommendation ?? "",
      source: args.source ?? "",
      decision: (args.decision ?? "").toLowerCase(),
      decided_by: args.decided_by ?? "",
      applied_at: "",
      baseline_amount: args.baseline_amount ?? null,
      after_amount: args.after_amount ?? null,
      currency: args.currency || "USD",
      measure_window_days: args.measure_window_days ?? 0,
      confounders: args.confounders ?? [],
      confounders_checked: Boolean(args.confounders_checked),
      tags: args.tags ?? [],
      logged_at: "",
    })

    const lines = [`Logged to the case ledger:\n${Cases.summary(c)}`]
    if (c.decision === Cases.APPROVED && !Cases.measured(c)) {
      lines.push("This case claims no saving yet. To close it, log it again with baseline_amount, after_amount and confounders_checked once the window ends.")
    }
    return { title: c.resource, output: lines.join("\n") }
  },
})
