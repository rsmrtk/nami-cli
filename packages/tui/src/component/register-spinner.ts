import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerRsmrtkSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
