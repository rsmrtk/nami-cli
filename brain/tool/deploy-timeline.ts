import { tool } from "@rsmrtk/plugin"
import { execFile } from "node:child_process"

// Ported from naki-cli (naki/agent/tools/deploy_timeline.py).

function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).killed) {
        resolve({ code: 1, out: "(timed out)" })
        return
      }
      if (error) {
        resolve({ code: (error as any).code ?? 1, out: (stdout.trim() || stderr.trim()) })
        return
      }
      resolve({ code: 0, out: stdout.trim() || stderr.trim() })
    })
  })
}

async function gitCommits(since: string, filePath?: string): Promise<string> {
  const args = ["log", `--since=${since}`, "--date=iso", "--pretty=format:%h  %ad  %an  %s"]
  if (filePath) args.push("--", filePath)
  const { code, out } = await run("git", args)
  if (code !== 0) return `(git log failed: ${out})`
  return out || "(no commits in this window)"
}

function hasGh(): Promise<boolean> {
  return new Promise((resolve) => execFile("which", ["gh"], (error) => resolve(!error)))
}

async function ciRuns(): Promise<string> {
  if (!(await hasGh())) return "(gh CLI not installed — skipping CI history)"

  const { code, out } = await run(
    "gh",
    ["run", "list", "--limit", "20", "--json", "displayTitle,status,conclusion,createdAt,headBranch"],
    20_000,
  )
  if (code !== 0) return `(gh run list unavailable: ${out.split("\n")[0] || "unknown error"})`

  let runs: any[]
  try {
    runs = JSON.parse(out)
  } catch {
    return "(could not parse gh output)"
  }
  if (!runs.length) return "(no CI runs found)"

  return runs
    .map((r) => {
      const status = r.conclusion || r.status || "?"
      return `${r.createdAt ?? "?"}  ${String(status).padEnd(10)}  ${String(r.headBranch ?? "?").padEnd(20)}  ${r.displayTitle ?? ""}`
    })
    .join("\n")
}

export default tool({
  description: `What changed recently — git commits in a time window, plus CI runs if the GitHub CLI is available. Start an incident investigation here: correlating 'when did it break' with 'what shipped just before' is where most root causes are found.`,
  args: {
    since: tool.schema
      .string()
      .describe("How far back to look, in git's own format: '2 hours ago', '3 days ago', '2026-09-25'. Defaults to '24 hours ago'.")
      .optional(),
    path: tool.schema.string().describe("Optional path to scope to one service/directory inside the repo.").optional(),
  },
  async execute(args) {
    const since = args.since || "24 hours ago"
    const scope = args.path ? ` (path: ${args.path})` : ""
    const output = [
      `=== git commits since ${since}${scope} ===\n${await gitCommits(since, args.path)}`,
      `=== recent CI runs (newest first, filter by date yourself) ===\n${await ciRuns()}`,
    ].join("\n\n")
    return { title: `since ${since}`, output }
  },
})
