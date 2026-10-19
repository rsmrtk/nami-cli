import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import path from "node:path"
import * as cases from "../tool/_shared/cases"
import * as evidence from "../tool/_shared/evidence"
import * as incidents from "../tool/_shared/incidents"
import { loadInfraMap, writeInfraMap } from "../tool/_shared/infra-map"
import { tempRoot } from "./helpers"

// Ported from naki-cli tests/test_incidents.py, test_cases.py, test_evidence.py:
// the team's own memory — what broke, what was decided, what it measured.

let tmp: Awaited<ReturnType<typeof tempRoot>>
beforeEach(async () => (tmp = await tempRoot()))
afterEach(() => tmp.cleanup())

const incident = (over: Partial<incidents.Incident> = {}): incidents.Incident => ({
  title: "checkout 5xx after deploy",
  service: "checkout",
  symptom: "",
  root_cause: "",
  resolution: "",
  related_change: "",
  tags: [],
  logged_at: "",
  ...over,
})

describe("the incident journal", () => {
  test("a logged incident can be found again", async () => {
    await incidents.log(incident({ root_cause: "connection pool exhausted" }), tmp.root)
    const found = await incidents.search("pool", tmp.root)
    expect(found.map((i) => i.title)).toEqual(["checkout 5xx after deploy"])
  })

  test("the journal is private to its owner", async () => {
    await incidents.log(incident(), tmp.root)
    const mode = (await stat(path.join(tmp.root, incidents.JOURNAL_PATH))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("a search with no usable terms returns the most recent first", async () => {
    await incidents.log(incident({ title: "first", logged_at: "2026-01-01T00:00:00" }), tmp.root)
    await incidents.log(incident({ title: "second", logged_at: "2026-01-02T00:00:00" }), tmp.root)
    expect((await incidents.search("", tmp.root)).map((i) => i.title)).toEqual(["second", "first"])
  })

  test("more matching terms rank higher", async () => {
    await incidents.log(incident({ title: "redis timeout", service: "a" }), tmp.root)
    await incidents.log(incident({ title: "redis timeout during failover", service: "b" }), tmp.root)
    const [top] = await incidents.search("redis failover", tmp.root)
    expect(top!.service).toBe("b")
  })

  test("a corrupt line is skipped, not fatal", async () => {
    await tmp.write(incidents.JOURNAL_PATH, '{"title":"ok","service":"","symptom":"","root_cause":"","resolution":"","related_change":"","tags":[],"logged_at":"2026-01-01"}\nnot json\n')
    expect(await incidents.allIncidents(tmp.root)).toHaveLength(1)
  })

  test("the same incident logged twice within hours is recognised, so history isn't doubled", async () => {
    await incidents.log(incident({ title: "checkout 5xx errors after deploy" }), tmp.root)
    const duplicate = await incidents.similarRecent(incident({ title: "checkout 5xx after the deploy" }), tmp.root)
    expect(duplicate).not.toBeNull()
  })

  test("a similar title on another service is a different incident", async () => {
    await incidents.log(incident({ service: "payments" }), tmp.root)
    expect(await incidents.similarRecent(incident({ service: "checkout" }), tmp.root)).toBeNull()
  })

  test("an old incident is not a duplicate", async () => {
    await incidents.log(incident({ logged_at: "2020-01-01T00:00:00" }), tmp.root)
    expect(await incidents.similarRecent(incident(), tmp.root)).toBeNull()
  })

  test("the summary says what was traced to what", () => {
    const text = incidents.summary(incident({ root_cause: "pool", related_change: "PR 41", logged_at: "2026-09-28T10:00:00" }))
    expect(text).toContain("2026-09-28")
    expect(text).toContain("root cause: pool")
    expect(text).toContain("traced to: PR 41")
  })
})

const caseOf = (over: Partial<cases.Case> = {}): cases.Case => ({
  pattern: "idle-disk",
  resource: "disk-1",
  finding: "unattached 90d",
  recommendation: "delete",
  source: "",
  decision: "",
  decided_by: "",
  applied_at: "",
  baseline_amount: null,
  after_amount: null,
  currency: "USD",
  measure_window_days: 0,
  confounders: [],
  confounders_checked: false,
  tags: [],
  logged_at: "",
  ...over,
})

describe("the case ledger: a saving counts only when it was measured", () => {
  test("undecided claims nothing", () => {
    expect(cases.savingState(caseOf())).toContain("not decided yet")
  })

  test("a declined case claims no saving", () => {
    expect(cases.savingState(caseOf({ decision: cases.DECLINED }))).toContain("no saving claimed — declined")
  })

  test("approved without an after-measurement is pending", () => {
    expect(cases.savingState(caseOf({ decision: cases.APPROVED, baseline_amount: 100 }))).toContain("pending measurement")
  })

  test("a delta nobody checked for other causes cannot be credited to the change", () => {
    const c = caseOf({ decision: cases.APPROVED, baseline_amount: 100, after_amount: 60 })
    expect(cases.savingState(c)).toContain("unattributed")
    expect(cases.measured(c)).toBe(false)
  })

  test("before, after and checked confounders make a measured saving", () => {
    const c = caseOf({ decision: cases.APPROVED, baseline_amount: 100, after_amount: 60, confounders_checked: true, measure_window_days: 30 })
    expect(cases.saving(c)).toBe(40)
    expect(cases.measured(c)).toBe(true)
    expect(cases.savingState(c)).toContain("measured saving 40.00 USD over 30d")
  })

  test("other changes in the window are named, not hidden", () => {
    const c = caseOf({ decision: cases.APPROVED, baseline_amount: 10, after_amount: 5, confounders_checked: true, confounders: ["deploy 4f2a"] })
    expect(cases.savingState(c)).toContain("deploy 4f2a")
  })

  test("an unknown decision is refused", async () => {
    await expect(cases.log(caseOf({ decision: "maybe" }), tmp.root)).rejects.toThrow(/decision must be one of/)
  })

  test("totals sum only measured savings, per currency", async () => {
    const measuredCase = { decision: cases.APPROVED, baseline_amount: 100, after_amount: 60, confounders_checked: true }
    await cases.log(caseOf({ ...measuredCase, resource: "a" }), tmp.root)
    await cases.log(caseOf({ ...measuredCase, resource: "b", currency: "EUR" }), tmp.root)
    await cases.log(caseOf({ decision: cases.APPROVED, baseline_amount: 999, after_amount: 0, resource: "c" }), tmp.root)
    await cases.log(caseOf({ decision: cases.DECLINED, resource: "d" }), tmp.root)

    const t = await cases.totals(tmp.root)
    expect(t).toMatchObject({ cases: 4, approved: 3, declined: 1, measured: 2, pending: 1 })
    expect(t.savingByCurrency).toEqual({ USD: 40, EUR: 40 })
  })

  test("search finds a case by what was found on the resource", async () => {
    await cases.log(caseOf({ resource: "payments-db", finding: "oversized instance" }), tmp.root)
    expect((await cases.search("oversized", tmp.root)).map((c) => c.resource)).toEqual(["payments-db"])
  })
})

describe("what was measured this turn", () => {
  beforeEach(() => evidence.beginTurn())

  test("advice to cut memory is contradicted when the container was being OOM-killed", () => {
    evidence.recordSqueezed("shop", "orders", "OOMKilled 4 times")
    const note = evidence.adviceAgainstTheMeasurement("You could reduce the memory request to save money.")
    expect(note).toContain("shop/orders")
    expect(note).toContain("not a saving opportunity")
  })

  test("the same advice is left alone when nothing contradicts it", () => {
    expect(evidence.adviceAgainstTheMeasurement("You could reduce the memory request.")).toBe("")
  })

  test("unrelated advice is left alone even when something was squeezed", () => {
    evidence.recordSqueezed("shop", "orders", "OOMKilled")
    expect(evidence.adviceAgainstTheMeasurement("The deploy looks healthy.")).toBe("")
  })

  test("advice to cut requests is unearned when the tool declined to recommend", () => {
    evidence.recordDecline("shop", "checkout", "only 20 minutes of usage history")
    const note = evidence.unearnedAdvice("Lower the requests to save money.")
    expect(note).toContain("shop/checkout")
    expect(note).toContain("only 20 minutes")
  })

  test("a recommendation that was earned silences the warning", () => {
    evidence.recordDecline("shop", "checkout", "thin")
    evidence.record("shop", "orders", "app", 0.2, 256)
    expect(evidence.unearnedAdvice("Lower the requests.")).toBe("")
  })

  test("recording the same decline twice keeps one entry", () => {
    evidence.recordDecline("a", "b", "r")
    evidence.recordDecline("a", "b", "r")
    expect(evidence.unearnedAdvice("reduce the request")).not.toContain("; ")
  })

  test("a new turn forgets the last one", () => {
    evidence.record("shop", "orders", "app")
    evidence.beginTurn()
    expect(evidence.recommendations()).toEqual([])
  })
})

describe("the infra map", () => {
  test("a missing map explains how to write one", async () => {
    const { services, error } = await loadInfraMap(tmp.root)
    expect(services).toBeNull()
    expect(error).toContain("depends_on")
  })

  test("a written map reads back", async () => {
    await writeInfraMap({ checkout: { depends_on: ["orders-db"] } }, tmp.root)
    const { services, error } = await loadInfraMap(tmp.root)
    expect(error).toBeNull()
    expect(services!.checkout!.depends_on).toEqual(["orders-db"])
  })

  test("invalid YAML is reported rather than treated as empty", async () => {
    await tmp.write(".naki/infra-map.yaml", "services: [ unclosed")
    expect((await loadInfraMap(tmp.root)).error).toContain("not valid YAML")
  })

  test("a file without a services mapping is reported", async () => {
    await tmp.write(".naki/infra-map.yaml", "other: 1\n")
    expect((await loadInfraMap(tmp.root)).error).toContain("no 'services:' mapping")
  })
})
