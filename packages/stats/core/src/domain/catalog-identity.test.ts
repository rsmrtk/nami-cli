import { describe, expect, test } from "bun:test"
import { catalogIdentity } from "./catalog-identity"

describe("stats catalog identity", () => {
  test("resolves Rsmrtk offerings to canonical labs", () => {
    const identity = catalogIdentity({
      models: { "meituan/longcat-2.5-preview": {} },
      providers: {
        rsmrtk: { models: { "longcat-2.5-preview-free": { canonical_model_id: "meituan/longcat-2.5-preview" } } },
        "rsmrtk-go": {
          models: { "longcat-2.5-preview-free": { canonical_model_id: "meituan/longcat-2.5-preview" } },
        },
      },
    })

    expect(identity.offerings.get("rsmrtk/longcat-2.5-preview-free")).toBe("meituan")
    expect(identity.offerings.get("rsmrtk-go/longcat-2.5-preview-free")).toBe("meituan")
    expect(identity.models.get("longcat-2.5-preview")).toBe("meituan")
  })

  test("does not guess a lab for a name shared by different canonical models", () => {
    const identity = catalogIdentity({
      models: { "lab-a/model": {}, "lab-b/model": {} },
      providers: {
        rsmrtk: { models: { "model-free": { canonical_model_id: "lab-a/model" } } },
        "rsmrtk-go": { models: { model: { canonical_model_id: "lab-b/model" } } },
      },
    })

    expect(identity.offerings.get("rsmrtk/model-free")).toBe("lab-a")
    expect(identity.offerings.get("rsmrtk-go/model")).toBe("lab-b")
    expect(identity.models.has("model")).toBe(false)
  })

  test("accepts provider IDs that are already canonical catalog IDs", () => {
    const identity = catalogIdentity({
      models: { "rsmrtk/direct-model": {} },
      providers: { rsmrtk: { models: { "direct-model": {} } } },
    })

    expect(identity.offerings.get("rsmrtk/direct-model")).toBe("rsmrtk")
    expect(identity.models.get("direct-model")).toBe("rsmrtk")
  })

  test("rejects a catalog without published canonical identities", () => {
    expect(() => catalogIdentity({ models: {}, providers: { rsmrtk: { models: { model: {} } } } })).toThrow(
      "Model catalog has no canonical Rsmrtk offerings",
    )
  })
})
