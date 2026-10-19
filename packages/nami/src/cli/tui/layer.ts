import { run as runTui, type TuiInput } from "@rsmrtk/tui"
import { Global } from "@rsmrtk/core/global"
import { AppNodeBuilder } from "@rsmrtk/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
