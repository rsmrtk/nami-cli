import { tool } from "@rsmrtk/plugin"
import { kubectlJson } from "./_shared/kubectl-json"
import { loadInfraMap, writeInfraMap, type ServiceEntry } from "./_shared/infra-map"

// Ported from naki-cli (naki/agent/discovery.py + tools/discover_infra.py).
// Every edge comes from something declared in the cluster — an ingress
// naming a service, a service selecting a workload's labels, an env var
// holding another service's address. Nothing is guessed from names that
// look similar: a map that invents edges is worse than no map.

function ownerOf(labels: Record<string, string>): string {
  for (const key of ["app.kubernetes.io/part-of", "team", "owner", "app.kubernetes.io/managed-by"]) {
    if (labels[key]) return labels[key]!
  }
  return ""
}

function externalRefs(podSpec: any, known: Set<string>): string[] {
  const refs = new Set<string>()
  for (const container of podSpec?.containers ?? []) {
    for (const env of container?.env ?? []) {
      const value = String(env?.value ?? "")
      if (!value) continue
      for (const candidate of known) {
        if (value.split(".")[0] === candidate || value.includes(`${candidate}.`) || value === candidate) {
          refs.add(candidate)
        }
      }
    }
  }
  return [...refs].sort()
}

async function discoverKubernetes(
  namespace?: string,
): Promise<{ services: Record<string, ServiceEntry>; notes: string[]; error: string }> {
  const scope = namespace ? ["-n", namespace] : ["--all-namespaces"]

  const { data: deployments, error } = await kubectlJson(["get", "deployments", ...scope])
  if (!deployments) {
    const prefix = error.includes("not reachable") ? "" : "cluster not reachable: "
    return { services: {}, notes: [], error: `${prefix}${error}` }
  }

  const { data: servicesRaw } = await kubectlJson(["get", "services", ...scope])
  const { data: ingressesRaw } = await kubectlJson(["get", "ingresses", ...scope])

  const found: Record<string, ServiceEntry> = {}
  const workloadLabels: Record<string, Record<string, string>> = {}

  for (const item of deployments.items ?? []) {
    const meta = item.metadata ?? {}
    const name = meta.name
    if (!name) continue
    const labels = meta.labels ?? {}
    const templateLabels = item.spec?.template?.metadata?.labels ?? {}
    workloadLabels[name] = templateLabels

    const entry: ServiceEntry = { kind: "deployment", namespace: meta.namespace ?? "default", depends_on: [] }
    const owner = ownerOf({ ...labels, ...templateLabels })
    if (owner) entry.owner = owner
    if (item.spec?.replicas !== undefined) entry.replicas = item.spec.replicas
    found[name] = entry
  }

  const knownNames = new Set(Object.keys(found))
  for (const item of deployments.items ?? []) {
    const name = item.metadata?.name
    if (!name || !found[name]) continue
    const podSpec = item.spec?.template?.spec ?? {}
    const refs = externalRefs(podSpec, knownNames).filter((r) => r !== name)
    if (refs.length) found[name]!.depends_on = [...new Set([...(found[name]!.depends_on ?? []), ...refs])].sort()
  }

  const notes: string[] = []

  const serviceTargets: Record<string, string[]> = {}
  for (const item of servicesRaw?.items ?? []) {
    const svcName = item.metadata?.name
    const selector = item.spec?.selector ?? {}
    if (!svcName || !Object.keys(selector).length) continue
    const targets = Object.entries(workloadLabels)
      .filter(([, labels]) => Object.entries(selector).every(([k, v]) => labels[k] === v))
      .map(([name]) => name)
    if (targets.length) serviceTargets[svcName] = targets
  }

  for (const item of ingressesRaw?.items ?? []) {
    const ingName = item.metadata?.name ?? "ingress"
    for (const rule of item.spec?.rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        const svcName = path.backend?.service?.name
        for (const workload of serviceTargets[svcName] ?? []) {
          found[workload]!.exposed_by = ingName
          notes.push(`${workload} is reachable from outside via ingress ${ingName}`)
        }
      }
    }
  }

  if (!Object.keys(found).length) notes.push("no deployments found — nothing to map yet")
  return { services: found, notes, error: "" }
}

function mergeMaps(existing: Record<string, ServiceEntry>, discovered: Record<string, ServiceEntry>): Record<string, ServiceEntry> {
  const merged: Record<string, ServiceEntry> = {}
  for (const [name, entry] of Object.entries(existing)) merged[name] = { ...entry }

  for (const [name, entry] of Object.entries(discovered)) {
    if (!merged[name]) {
      merged[name] = { ...entry, discovered: true }
      continue
    }
    const current = merged[name]!
    for (const [key, value] of Object.entries(entry)) {
      if (key === "depends_on") {
        current.depends_on = [...new Set([...(current.depends_on ?? []), ...((value as string[]) ?? [])])].sort()
      } else if (!(key in current)) {
        ;(current as any)[key] = value
      }
    }
  }
  return merged
}

function render(services: Record<string, ServiceEntry>, notes: string[], writtenTo: string | null): string {
  const lines = [`discovered ${Object.keys(services).length} workload(s)`]
  for (const name of Object.keys(services).sort()) {
    const entry = services[name]!
    const bits = [`  ${name}`]
    if (entry.namespace) bits.push(`ns=${entry.namespace}`)
    if (entry.owner) bits.push(`owner=${entry.owner}`)
    if (entry.replicas !== undefined) bits.push(`replicas=${entry.replicas}`)
    if (entry.exposed_by) bits.push(`ingress=${entry.exposed_by}`)
    lines.push(bits.join("  "))
    if (entry.depends_on?.length) lines.push(`      depends on: ${entry.depends_on.join(", ")}`)
  }
  if (notes.length) {
    lines.push("")
    lines.push(...notes.map((n) => `  note: ${n}`))
  }
  lines.push(
    writtenTo
      ? `\nWritten to ${writtenTo} — dependency_map reads it from here on.`
      : "\nPreview only. Call again with write=true to save it to .naki/infra-map.yaml.",
  )
  return lines.join("\n")
}

export default tool({
  description: `Scan the connected Kubernetes cluster and build the infra map that dependency_map reads — workloads, who owns them, what they depend on, and what's exposed through an ingress. Every edge comes from something declared in the cluster, never inferred from similar names. Hand-written entries in the map are kept as-is; this only fills gaps.`,
  args: {
    namespace: tool.schema.string().describe("Limit the scan to one namespace. Omit to scan all of them.").optional(),
    write: tool.schema.boolean().describe("Write the result to .naki/infra-map.yaml. Defaults to false — preview first.").optional(),
  },
  async execute(args, ctx) {
    const result = await discoverKubernetes(args.namespace)
    if (result.error) return { title: "discover_infra", output: `Error: ${result.error}` }

    const { services: existing } = await loadInfraMap()
    const merged = mergeMaps(existing ?? {}, result.services)

    if (!args.write) return { title: "discover_infra", output: render(merged, result.notes, null) }

    await ctx.ask({
      permission: "discover_infra",
      patterns: [".naki/infra-map.yaml"],
      always: ["*"],
      metadata: { namespace: args.namespace, write: true },
    })

    try {
      const filePath = await writeInfraMap(merged)
      return { title: "discover_infra", output: render(merged, result.notes, filePath) }
    } catch (exc: any) {
      return { title: "discover_infra", output: `${render(merged, result.notes, null)}\n\n(Could not write .naki/infra-map.yaml: ${exc.message})` }
    }
  },
})
