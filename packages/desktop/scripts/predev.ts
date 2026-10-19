import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.RSMRTK_CHANNEL ?? "dev"}`

await $`cd ../rsmrtk && bun script/build-node.ts`
await downloadCliToResources()
