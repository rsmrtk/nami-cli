import path from "path"
import fsNode from "fs/promises"

// Локальна збірка (bun з вихідників): @rsmrtk/plugin живе в цьому монорепо і в npm не публікується,
// тож замість `npm install` (404 + довге очікування на старті) лінкуємо воркспейс-пакет.
const LOCAL_PLUGIN_DIR = path.resolve(import.meta.dir, "../../../plugin")

export async function linkLocalPlugin(dir: string) {
  const scope = path.join(dir, "node_modules", "@rsmrtk")
  const link = path.join(scope, "plugin")
  const current = await fsNode.readlink(link).catch(() => undefined)
  if (current === LOCAL_PLUGIN_DIR) return
  await fsNode.mkdir(scope, { recursive: true })
  await fsNode.rm(link, { recursive: true, force: true })
  await fsNode.symlink(LOCAL_PLUGIN_DIR, link, "dir")
}
