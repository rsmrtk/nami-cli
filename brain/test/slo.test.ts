import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as slo from "../tool/_shared/slo"
import { tempRoot, stubPrometheus } from "./helpers"

// Ported from naki-cli tests/test_slo.py.

const DEFINITION = `
slos:
  checkout-availability:
    objective: 99.9
    window: 30d
    service: checkout
    good: 'sum(rate(http_requests_total{job="checkout",code!~"5.."}[5m]))'
    total: 'sum(rate(http_requests_total{job="checkout"}[5m]))'
`

const definition = (): slo.SLODefinition => ({
  name: "checkout",
  objective: 99.9,
  window: "30d",
  good: "good_q",
  total: "total_q",
  service: "",
})

const everyWindow = (value: number) =>
  Object.fromEntries(["30d", "1h", "5m", "6h", "30m", "1d", "2h", "3d"].map((w) => [w, value]))

describe("the arithmetic", () => {
  test.each([
    [99.9, 0.001],
    [99.0, 0.01],
    [99.99, 0.0001],
    [95.0, 0.05],
  ])("error budget of %p%% is the share allowed to fail (%p)", (objective, expected) => {
    expect(slo.errorBudget(objective)).toBeCloseTo(expected, 10)
  })

  test("a burn rate of one means the budget lasts exactly the window", () => {
    expect(slo.burnRate(0.999, 99.9)).toBeCloseTo(1.0, 6)
  })

  test("burn rate scales with how fast the budget goes", () => {
    expect(slo.burnRate(0.99, 99.9)).toBeCloseTo(10.0, 6)
    expect(slo.burnRate(1.0, 99.9)).toBeCloseTo(0.0, 6)
  })

  test("a perfect objective does not divide by zero", () => {
    expect(slo.burnRate(0.5, 100.0)).toBe(0)
  })
})

describe("burn-rate alerting", () => {
  test("a fast burn pages", () => {
    const alerts = slo.evaluateAlerts({ "1h": 20, "5m": 20, "6h": 1, "30m": 1 })
    expect(alerts.some((a) => a.startsWith("PAGE"))).toBe(true)
  })

  test("a long window alone does not page — the short one stops a resolved blip paging hours later", () => {
    expect(slo.evaluateAlerts({ "1h": 20, "5m": 0.1 })).toEqual([])
  })

  test("a short spike alone does not page", () => {
    expect(slo.evaluateAlerts({ "1h": 0.1, "5m": 50 })).toEqual([])
  })

  test("a slow burn is a ticket, not a page", () => {
    const alerts = slo.evaluateAlerts({ "1d": 3.5, "2h": 3.5 })
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts.every((a) => a.startsWith("TICKET"))).toBe(true)
  })

  test("a healthy service raises nothing", () => {
    const rates = Object.fromEntries(slo.BURN_WINDOWS.flatMap(([l, s]) => [[l, 0.2], [s, 0.2]]))
    expect(slo.evaluateAlerts(rates)).toEqual([])
  })

  test("a missing window is skipped, not guessed", () => {
    expect(slo.evaluateAlerts({ "1h": 99 })).toEqual([])
  })
})

describe("loading definitions", () => {
  let tmp: Awaited<ReturnType<typeof tempRoot>>
  beforeEach(async () => (tmp = await tempRoot()))
  afterEach(() => tmp.cleanup())

  test("loads a definition", async () => {
    await tmp.write(slo.SLO_PATH, DEFINITION)
    const { slos, problems } = await slo.load(tmp.root)
    expect(problems).toEqual([])
    const loaded = slos["checkout-availability"]!
    expect(loaded.objective).toBe(99.9)
    expect(loaded.window).toBe("30d")
    expect(loaded.service).toBe("checkout")
  })

  test("no file means no SLOs", async () => {
    expect(await slo.load(tmp.root)).toEqual({ slos: {}, problems: [] })
  })

  test("an SLO missing its queries is skipped and reported", async () => {
    await tmp.write(slo.SLO_PATH, "slos:\n  broken:\n    objective: 99.9\n")
    const { slos, problems } = await slo.load(tmp.root)
    expect(slos).toEqual({})
    expect(problems.some((p) => p.includes("missing"))).toBe(true)
  })

  test("a nonsense objective is rejected", async () => {
    await tmp.write(slo.SLO_PATH, "slos:\n  broken:\n    objective: 150\n    good: 'a'\n    total: 'b'\n")
    const { slos, problems } = await slo.load(tmp.root)
    expect(slos).toEqual({})
    expect(problems.some((p) => p.includes("between 0 and 100"))).toBe(true)
  })

  test("a broken SLO does not take down the good ones", async () => {
    await tmp.write(slo.SLO_PATH, DEFINITION + "  broken:\n    objective: 99.9\n")
    const { slos, problems } = await slo.load(tmp.root)
    expect(Object.keys(slos)).toEqual(["checkout-availability"])
    expect(problems.length).toBeGreaterThan(0)
  })

  test("invalid YAML is reported", async () => {
    await tmp.write(slo.SLO_PATH, "slos: [ unclosed")
    const { slos, problems } = await slo.load(tmp.root)
    expect(slos).toEqual({})
    expect(problems.some((p) => p.includes("not valid YAML"))).toBe(true)
  })
})

describe("measuring against Prometheus", () => {
  let restore: () => void
  const original = process.env.NAKI_PROMETHEUS_URL
  beforeEach(() => {
    process.env.NAKI_PROMETHEUS_URL = "http://prometheus.test"
  })
  afterEach(() => {
    restore?.()
    if (original === undefined) delete process.env.NAKI_PROMETHEUS_URL
    else process.env.NAKI_PROMETHEUS_URL = original
  })

  test("measures the SLI and the budget consumed", async () => {
    restore = stubPrometheus({ ...everyWindow(1.0), "30d": 0.9995 })
    const status = await slo.measure(definition())
    expect(status.sli).toBeCloseTo(0.9995, 6)
    // 0.05% failures against a 0.1% budget = half the budget gone.
    expect(status.budgetConsumed).toBeCloseTo(0.5, 6)
    expect(slo.budgetRemaining(status)).toBeCloseTo(0.5, 6)
  })

  test("budget consumed never exceeds the whole budget", async () => {
    restore = stubPrometheus(everyWindow(0.5))
    const status = await slo.measure(definition())
    expect(status.budgetConsumed).toBe(1)
    expect(slo.budgetRemaining(status)).toBe(0)
  })

  test("an unmeasurable SLI reports the problem rather than a number", async () => {
    restore = stubPrometheus({})
    const status = await slo.measure(definition())
    expect(status.sli).toBeNull()
    expect(status.budgetConsumed).toBeNull()
    expect(status.problems.some((p) => p.includes("matched no series"))).toBe(true)
    expect(slo.describe(status)).toContain("could not be measured")
  })

  test("a burning service surfaces the page", async () => {
    restore = stubPrometheus({ ...everyWindow(0.999), "1h": 0.98, "5m": 0.98 })
    const status = await slo.measure(definition())
    expect(status.alerts.some((a) => a.startsWith("PAGE"))).toBe(true)
    expect(slo.describe(status)).toContain("PAGE")
  })
})

describe("what the agent reads", () => {
  const status = (over: Partial<slo.SLOStatus>): slo.SLOStatus => ({
    slo: { ...definition(), service: "checkout" },
    sli: 0.9995,
    budgetConsumed: 0.5,
    burnRates: { "1h": 0.5 },
    alerts: [],
    problems: [],
    ...over,
  })

  test("an exhausted budget says so plainly", () => {
    expect(slo.describe(status({ sli: 0.9, budgetConsumed: 1 }))).toContain("exhausted")
  })

  test("the description names the objective and the measurement", () => {
    const rendered = slo.describe(status({}))
    expect(rendered).toContain("objective 99.9%")
    expect(rendered).toContain("99.950%")
    expect(rendered).toContain("50.0% remaining")
    expect(rendered).toContain("no burn-rate alert would be firing")
  })
})
