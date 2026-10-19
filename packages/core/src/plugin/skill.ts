/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeRsmrtkContent from "./skill/customize-rsmrtk.md" with { type: "text" }

export const CustomizeRsmrtkContent = customizeRsmrtkContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-rsmrtk",
            description:
              "Use ONLY when the user is editing or creating rsmrtk's own configuration: rsmrtk.json, rsmrtk.jsonc, files under .rsmrtk/, or files under ~/.config/rsmrtk/. Also use when creating or fixing rsmrtk agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring rsmrtk itself.",
            location: AbsolutePath.make("/builtin/customize-rsmrtk.md"),
            content: CustomizeRsmrtkContent,
          }),
        }),
      )
    })
  }),
})
