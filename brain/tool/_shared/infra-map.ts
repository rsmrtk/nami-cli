import { parse as parseYaml, stringify as toYaml } from "yaml"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

// Ported from naki-cli (naki/agent/tools/dependency_map.py's _load_map).
// .naki/ is naki's own config convention, independent of box's branding —
// kept as-is so a project already using naki-cli needs nothing new.
export const INFRA_MAP_PATH = path.join(".naki", "infra-map.yaml")

export type ServiceEntry = {
  kind?: string
  namespace?: string
  owner?: string
  replicas?: number
  depends_on?: string[]
  exposed_by?: string
  discovered?: boolean
}

export async function loadInfraMap(root = process.cwd()): Promise<{ services: Record<string, ServiceEntry> | null; error: string | null }> {
  const filePath = path.join(root, INFRA_MAP_PATH)
  if (!existsSync(filePath)) {
    return {
      services: null,
      error:
        `No infra map at ${filePath}. Create it to give naki real dependency facts — format:\n` +
        "services:\n  checkout:\n    depends_on: [rds-orders, redis-cache]\n    owner: payments-team\n",
    }
  }
  let data: any
  try {
    data = parseYaml(await readFile(filePath, "utf-8")) ?? {}
  } catch (exc: any) {
    return { services: null, error: `Error: ${filePath} is not valid YAML: ${exc.message}` }
  }
  const services = data?.services
  if (typeof services !== "object" || services === null || Array.isArray(services)) {
    return { services: null, error: `Error: ${filePath} has no 'services:' mapping at the top level.` }
  }
  return { services, error: null }
}

export async function writeInfraMap(services: Record<string, ServiceEntry>, root = process.cwd()): Promise<string> {
  const filePath = path.join(root, INFRA_MAP_PATH)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, toYaml({ services }, { sortMapEntries: true }))
  return filePath
}
