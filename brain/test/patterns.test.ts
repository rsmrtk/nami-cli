import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as patterns from "../tool/_shared/patterns"
import { tempRoot } from "./helpers"

// Ported from naki-cli tests/test_patterns.py. Every rule here is a failure
// this project already had: a threshold set by eye, a saving quoted without
// the reliability cost that came with it.

const valid = (over: Record<string, unknown> = {}) => ({
  id: "example",
  title: "Example",
  domain: "finops",
  provider: "gcp",
  signal: { tool: "find_idle_resources" },
  reliability: { cost: "deleting is not reversible", guards: ["report only"] },
  ...over,
})

describe("the rules the pack enforces", () => {
  test("a threshold without a reason does not load", () => {
    expect(() => patterns.parse(valid({ thresholds: { age_days: { value: 90 } } }))).toThrow(/reason/)
  })

  test("a threshold with a reason loads and keeps it", () => {
    const p = patterns.parse(valid({ thresholds: { age_days: { value: 90, reason: "a quarter is a policy or a mistake" } } }))
    expect(patterns.threshold(p, "age_days")).toBe(90)
    expect(p.thresholds.age_days!.reason).toContain("policy")
  })

  test("a saving without a guard is refused", () => {
    expect(() => patterns.parse(valid({ reliability: { cost: "something", guards: [] } }))).toThrow(/at least one guard/)
  })

  test("a pattern must say what acting on it risks", () => {
    expect(() => patterns.parse(valid({ reliability: { guards: ["x"] } }))).toThrow(/reliability\.cost is required/)
  })

  test("an unknown key is refused rather than ignored", () => {
    expect(() => patterns.parse(valid({ treshholds: { x: { value: 1, reason: "typo" } } }))).toThrow(/unknown key/)
  })

  test("a signal must name the tool that detects it", () => {
    expect(() => patterns.parse(valid({ signal: {} }))).toThrow(/signal\.tool/)
  })

  test("an unknown provider is refused", () => {
    expect(() => patterns.parse(valid({ provider: "oracle" }))).toThrow(/provider must be one of/)
  })

  test("asking for a threshold the pattern does not have is an error, not a default", () => {
    const p = patterns.parse(valid())
    expect(() => patterns.threshold(p, "nope")).toThrow(/no threshold 'nope'/)
  })
})

describe("how much to trust a number", () => {
  test("a price below three observations is flagged as a list price", () => {
    const p = patterns.parse(valid({ prices: { disk_gb: { value: 0.04, reason: "list price", observed_on: 1 } } }))
    expect(patterns.caveat(p)).toContain("public list prices")
  })

  test("a verified pattern carries no caveat", () => {
    const p = patterns.parse(valid({ verified: true }))
    expect(patterns.caveat(p)).toBe("")
  })

  test("three observations is enough to stop calling a threshold a placeholder", () => {
    const p = patterns.parse(valid({ thresholds: { age_days: { value: 90, reason: "r", observed_on: 3 } } }))
    expect(patterns.caveat(p)).toContain("not yet checked against a real bill")
  })
})

describe("loading a pack from disk", () => {
  let tmp: Awaited<ReturnType<typeof tempRoot>>
  beforeEach(async () => (tmp = await tempRoot()))
  afterEach(() => tmp.cleanup())

  const body = (id: string) =>
    `id: ${id}\ntitle: T\ndomain: finops\nprovider: aws\nsignal: {tool: find_idle_resources}\nreliability: {cost: c, guards: [g]}\n`

  test("no pack directory means no patterns", async () => {
    expect(await patterns.load(tmp.root)).toEqual({ patterns: {}, problems: [] })
  })

  test("a bad file is reported and the good ones still load", async () => {
    await tmp.write(".naki/patterns/a.yaml", body("alpha"))
    await tmp.write(".naki/patterns/b.yaml", "id: broken\n")
    const { patterns: found, problems } = await patterns.load(tmp.root)
    expect(Object.keys(found)).toEqual(["alpha"])
    expect(problems.some((p) => p.startsWith("b.yaml"))).toBe(true)
  })

  test("a duplicate id is reported, not silently overwritten", async () => {
    await tmp.write(".naki/patterns/a.yaml", body("same"))
    await tmp.write(".naki/patterns/b.yaml", body("same"))
    const { patterns: found, problems } = await patterns.load(tmp.root)
    expect(Object.keys(found)).toEqual(["same"])
    expect(problems.some((p) => p.includes("duplicate pattern id same"))).toBe(true)
  })

  test("get returns null for an unknown id", async () => {
    expect(await patterns.get("nope", tmp.root)).toBeNull()
  })
})
