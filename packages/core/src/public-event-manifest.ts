export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@rsmrtk/schema/event"
import { EventManifest } from "@rsmrtk/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
