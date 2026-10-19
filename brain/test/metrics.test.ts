import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as auth from "../tool/_shared/metrics-auth"
import { instant, noPrometheusError, parseDuration, summarizeSeries } from "../tool/_shared/prometheus"

// Ported from naki-cli tests/test_metrics_auth.py (the none/bearer subset
// that exists here) and the series-summary helpers of metric_query.

const keys = ["NAKI_METRICS_AUTH", "NAKI_METRICS_TOKEN", "NAKI_PROMETHEUS_URL"]
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  for (const k of keys) delete process.env[k]
})
afterEach(() => {
  for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
})

describe("choosing the auth mode", () => {
  test("a plain endpoint needs no auth", () => {
    expect(auth.detect("http://localhost:9090")).toBe(auth.NONE)
  })

  test.each([
    ["https://aps-workspaces.eu-west-1.amazonaws.com/workspaces/ws-1", auth.AWS_SIGV4],
    ["https://monitoring.googleapis.com/v1/projects/p/location/global/prometheus", auth.GCP],
    ["https://x.westeurope.prometheus.monitor.azure.com", auth.AZURE],
  ])("%s is recognised as a managed endpoint", (url, mode) => {
    expect(auth.detect(url)).toBe(mode)
  })

  test("an unparseable URL falls back to none rather than throwing", () => {
    expect(auth.detect("not a url")).toBe(auth.NONE)
  })

  test("an explicit mode wins over detection", () => {
    process.env.NAKI_METRICS_AUTH = "bearer"
    expect(auth.modeFor("https://monitoring.googleapis.com")).toBe(auth.BEARER)
  })
})

describe("headers", () => {
  test("none sends nothing", () => {
    expect(auth.headersFor("http://localhost:9090")).toEqual({})
  })

  test("bearer sends the token", () => {
    process.env.NAKI_METRICS_AUTH = "bearer"
    process.env.NAKI_METRICS_TOKEN = " s3cret "
    expect(auth.headersFor("http://x")).toEqual({ Authorization: "Bearer s3cret" })
  })

  test("bearer with no token sends nothing rather than 'Bearer '", () => {
    process.env.NAKI_METRICS_AUTH = "bearer"
    expect(auth.headersFor("http://x")).toEqual({})
  })

  test("describe never reveals the token", () => {
    process.env.NAKI_METRICS_AUTH = "bearer"
    process.env.NAKI_METRICS_TOKEN = "s3cret"
    expect(auth.describe("http://x")).not.toContain("s3cret")
  })

  test("an un-ported managed mode says so instead of pretending to authenticate", () => {
    expect(auth.describe("https://monitoring.googleapis.com")).toContain("isn't ported")
  })
})

describe("durations", () => {
  test.each([
    ["5m", 300],
    ["1h", 3600],
    ["2d", 172800],
    ["90", 90],
    ["", 3600],
    ["junk", 3600],
  ])("%p parses to %p seconds", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds)
  })
})

describe("summarising a series", () => {
  test("no series is said plainly", () => {
    expect(summarizeSeries([])).toBe("(query returned no series)")
  })

  test("reports the count and the extremes, not just the points", () => {
    const out = summarizeSeries([{ metric: { __name__: "up", job: "x" }, values: [[0, "1"], [60, "0"], [120, "1"]] }])
    expect(out).toContain("up{job=x}")
    expect(out).toContain("3 points")
    expect(out).toContain("min 0")
    expect(out).toContain("max 1")
  })

  test("more than five series is truncated with a hint to narrow the query", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ metric: { i: String(i) }, values: [[0, "1"]] }))
    expect(summarizeSeries(many)).toContain("and 2 more series")
  })

  test("a series of non-numbers is reported, not crashed on", () => {
    expect(summarizeSeries([{ metric: {}, values: [[0, "NaN"]] }])).toContain("no numeric points")
  })
})

describe("instant queries", () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })
  const reply = (body: unknown, status = 200) => {
    globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch
    process.env.NAKI_PROMETHEUS_URL = "http://prometheus.test"
  }

  test("returns the scalar", async () => {
    reply({ status: "success", data: { result: [{ value: [0, "0.5"] }] } })
    expect(await instant("q")).toEqual([0.5, ""])
  })

  test("no series is a problem, not a zero", async () => {
    reply({ status: "success", data: { result: [] } })
    const [value, problem] = await instant("q")
    expect(value).toBeNull()
    expect(problem).toContain("matched no series")
  })

  test("a rejected query surfaces Prometheus' own reason", async () => {
    reply({ status: "error", error: "parse error" })
    const [value, problem] = await instant("q")
    expect(value).toBeNull()
    expect(problem).toContain("parse error")
  })

  test("an HTTP failure is reported with the auth mode that was used", async () => {
    reply({}, 500)
    const [value, problem] = await instant("q")
    expect(value).toBeNull()
    expect(problem).toContain("auth:")
  })

  test("without a configured endpoint the error names the variable to set", () => {
    expect(noPrometheusError()).toContain("NAKI_PROMETHEUS_URL")
  })
})
