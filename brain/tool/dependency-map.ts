import { tool } from "@rsmrtk/plugin"
import { loadInfraMap, type ServiceEntry } from "./_shared/infra-map"

// Ported from naki-cli (naki/agent/tools/dependency_map.py).

function describe(name: string, entry: ServiceEntry): string {
  const dependsOn = entry.depends_on ?? []
  const lines = [name]
  if (entry.owner) lines.push(`  owner: ${entry.owner}`)
  lines.push(`  depends on: ${dependsOn.length ? dependsOn.join(", ") : "(nothing declared)"}`)
  return lines.join("\n")
}

export default tool({
  description: `What a service depends on, and what depends on it, read from the project's declared infra map (.naki/infra-map.yaml). These are facts someone wrote down, not inferred — if the map or the service isn't there, it says so instead of guessing. Use it early in an investigation to know the blast radius.`,
  args: {
    service: tool.schema.string().describe("Service name to look up. Omit to list everything in the map.").optional(),
  },
  async execute(args) {
    const { services, error } = await loadInfraMap()
    if (!services) return { title: "dependency_map", output: error ?? "Error: could not read infra map" }

    const service = args.service
    if (!service) {
      const names = Object.keys(services).sort()
      return {
        title: "dependency_map",
        output: `${names.length} services in the map:\n` + names.map((n) => `  ${n}`).join("\n"),
      }
    }

    const entry = services[service]
    if (!entry) {
      const close = Object.keys(services).filter((n) => n.toLowerCase().includes(service.toLowerCase()))
      const hint = close.length ? ` Did you mean: ${close.join(", ")}?` : ""
      return { title: service, output: `Error: '${service}' is not in the infra map.${hint}` }
    }

    const dependents = Object.keys(services)
      .filter((name) => (services[name]!.depends_on ?? []).includes(service))
      .sort()

    const output = [
      describe(service, entry),
      `  depended on by: ${dependents.length ? dependents.join(", ") : "(nothing declared)"}`,
    ].join("\n")

    return { title: service, output }
  },
})
