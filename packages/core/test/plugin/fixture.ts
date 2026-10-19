import { AgentV2 } from "@rsmrtk/core/agent"
import { AISDK } from "@rsmrtk/core/aisdk"
import { Catalog } from "@rsmrtk/core/catalog"
import { CommandV2 } from "@rsmrtk/core/command"
import { Credential } from "@rsmrtk/core/credential"
import { AppNodeBuilder } from "@rsmrtk/core/effect/app-node-builder"
import { LayerNodePlatform } from "@rsmrtk/core/effect/app-node-platform"
import { LayerNode } from "@rsmrtk/core/effect/layer-node"
import { EventV2 } from "@rsmrtk/core/event"
import { FileSystem } from "@rsmrtk/core/filesystem"
import { FSUtil } from "@rsmrtk/core/fs-util"
import { Integration } from "@rsmrtk/core/integration"
import { Location } from "@rsmrtk/core/location"
import { Npm } from "@rsmrtk/core/npm"
import { PluginV2 } from "@rsmrtk/core/plugin"
import { Reference } from "@rsmrtk/core/reference"
import { SkillV2 } from "@rsmrtk/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
