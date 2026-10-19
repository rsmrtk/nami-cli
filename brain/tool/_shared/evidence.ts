// Ported from naki-cli (naki/agent/evidence.py) — the in-process record of
// what a measurement tool actually measured this turn, so a later guard
// can check a cut against real evidence instead of trusting the model's
// restatement of it.
//
// Not wired up: naki's own guard lived beside its policy/command-permission
// layer and intercepted every `kubectl set resources`/`patch`/`apply` before
// it ran, citing this state to refuse an unearned cut. box has no equivalent
// interception point in front of its own shell tool yet, so recording here
// is honest bookkeeping with no enforcement behind it — a future bash-tool
// permission hook could read `recommendations()` to add the guard for real.
//
// Module-level state, same as the Python original: it survives across tool
// calls within one running box process, which is what lets `k8s_rightsizing`
// recommend a floor in one call and (eventually) a guard check it in the
// next. It does NOT survive a restart, and nothing here currently resets it
// at the start of a new user turn (naki's own `begin_turn()`) — call
// `beginTurn()` yourself if a caller needs that boundary.

export type Recommendation = { namespace: string; workload: string; container: string; cpuFloor: number | null; memFloor: number | null }

const recorded: Recommendation[] = []
const declined: [string, string][] = []
const squeezed: [string, string][] = []

export function beginTurn(): void {
  recorded.length = 0
  declined.length = 0
  squeezed.length = 0
}

export function record(namespace: string, workload: string, container: string, cpuFloor: number | null = null, memFloor: number | null = null): void {
  recorded.push({ namespace, workload, container, cpuFloor, memFloor })
}

export function recordDecline(namespace: string, workload: string, reason: string): void {
  const entry: [string, string] = [`${namespace}/${workload}`, reason]
  if (!declined.some(([target, r]) => target === entry[0] && r === entry[1])) declined.push(entry)
}

export function recordSqueezed(namespace: string, workload: string, detail: string): void {
  const entry: [string, string] = [namespace ? `${namespace}/${workload}` : workload, detail]
  if (!squeezed.some(([target, d]) => target === entry[0] && d === entry[1])) squeezed.push(entry)
}

export function recommendations(): Recommendation[] {
  return [...recorded]
}

const MEMORY_CUT_PHRASES = [
  "reduce the memory request", "reduce its memory", "reduce memory request",
  "lower the memory request", "lower its memory", "lower memory request",
  "decrease the memory request", "decrease its memory",
  "cut the memory request", "cut its memory", "shrink the memory",
  "reduce the memory limit", "lower the memory limit", "decrease the memory limit",
]

export function adviceAgainstTheMeasurement(answer: string): string {
  if (!squeezed.length) return ""
  const lowered = (answer ?? "").toLowerCase()
  if (!MEMORY_CUT_PHRASES.some((p) => lowered.includes(p))) return ""

  const where = squeezed.slice(0, 3).map(([target, detail]) => `${target}: ${detail}`).join("; ")
  return (
    "\n\n[naki] The answer above advises lowering memory, and the measurement in this " +
    "turn says the opposite — " + where + ". A container killed for exceeding its " +
    "memory is under-provisioned: it needs more, and taking more away makes the " +
    "restarts faster, not the bill smaller. This is not a saving opportunity."
  )
}

const ADVICE_PHRASES = [
  "reduce the request", "reduce requests", "lower the request", "lower requests",
  "decrease the request", "decrease requests", "cut the request", "cut requests",
  "set requests to", "reduce the cpu request", "reduce the memory request",
  "rightsize it down", "downsize the request",
]

export function unearnedAdvice(answer: string): string {
  if (!declined.length || recorded.length) return ""
  const lowered = (answer ?? "").toLowerCase()
  if (!ADVICE_PHRASES.some((p) => lowered.includes(p))) return ""

  const where = declined.slice(0, 3).map(([target, reason]) => `${target} — ${reason}`).join("; ")
  return (
    "\n\n[naki] The answer above advises lowering a Kubernetes request, and no " +
    "measurement in this turn supports one: " + where + ". A request is a scheduling " +
    "guarantee, so the saving is immediate and the failure is delayed. Nothing here " +
    "says the current requests are right — only that this evidence cannot size them."
  )
}
