import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@rsmrtk/core/effect/app-node-builder"
import { AbsolutePath } from "@rsmrtk/core/schema"
import { Reference } from "@rsmrtk/core/reference"
import { ReferenceGuidance } from "@rsmrtk/core/reference/guidance"
import { SystemContext } from "@rsmrtk/core/system-context/index"
import { it } from "./lib/effect"

const guidanceLayer = (referenceLayer: Layer.Layer<Reference.Service>) =>
  AppNodeBuilder.build(ReferenceGuidance.node, [[Reference.node, referenceLayer]])

describe("ReferenceGuidance", () => {
  it.effect("lists available references in the system context", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())

      expect(generation.baseline).toContain("<available_references>")
      expect(generation.baseline).toContain("<name>docs</name>")
      expect(generation.baseline).toContain("<path>/docs</path>")
      expect(generation.baseline).toContain("<description>Use for product documentation</description>")
    }).pipe(
      Effect.provide(
        guidanceLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                new Reference.Info({
                  name: "docs",
                  path: AbsolutePath.make("/docs"),
                  description: "Use for product documentation",
                  source: Reference.LocalSource.make({
                    type: "local",
                    path: AbsolutePath.make("/docs"),
                    description: "Use for product documentation",
                  }),
                }),
              ]),
          }),
        ),
      ),
    ),
  )

  it.effect("omits guidance when no references are available", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.baseline).toBe("")
    }).pipe(Effect.provide(guidanceLayer(Layer.mock(Reference.Service, { list: () => Effect.succeed([]) })))),
  )

  it.effect("omits references without descriptions", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.baseline).toBe("")
    }).pipe(
      Effect.provide(
        guidanceLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                new Reference.Info({
                  name: "docs",
                  path: AbsolutePath.make("/docs"),
                  source: Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/docs") }),
                }),
              ]),
          }),
        ),
      ),
    ),
  )
})
