import { tool } from "@rsmrtk/plugin"
import { execFile } from "node:child_process"

// Ported from naki-cli (naki/agent/blast_radius.py + tools/blast_radius.py).
// What a destructive action would actually touch, assembled before it runs —
// facts pulled from the live cluster, not a risk score invented from nothing.
//
// Not ported: the infra dependency-map cross-reference (naki's
// discover_infra/dependency_map). Rather than silently drop that half of
// the picture, it is reported as an unknown — the tool's own description
// promises "reports only what it could verify, and says what it couldn't,"
// and a missing dependency map is exactly that kind of gap, not a reason
// to pretend it was checked.

const K8S_DESTRUCTIVE = /kubectl\s+(?<verb>delete|scale|drain|cordon|rollout\s+undo|rollout\s+restart|patch)\s+(?<rest>.+)/i
const TERRAFORM_DESTRUCTIVE = /terraform\s+(destroy|apply)/i
const HELM_DESTRUCTIVE = /helm\s+(uninstall|rollback|upgrade)/i

// Every spelling of the namespace flag real kubectl accepts: `-n prod`,
// `-nprod`, `-n=prod`, `--namespace prod`, `--namespace=prod`. A missed
// namespace is not cosmetic — the blast radius would be computed against
// `default` while the command hits production.
const NAMESPACE_FLAG = /(?:^|\s)(?:-n|--namespace)(?:\s*=\s*|\s+|(?=\S))\s*(?<value>'[^']*'|"[^"]*"|\S+)/
const ALL_NAMESPACES_FLAG = /(?:^|\s)(?:-A|--all-namespaces)(?:\s|=true|$)/
const ALL_NAMESPACES = "*"

type Target = { kind: string; name: string; namespace: string }
type Assessment = { headline: string; findings: string[]; unknowns: string[] }

function render(a: Assessment): string {
  return [a.headline, ...a.findings.map((f) => `  · ${f}`), ...a.unknowns.map((u) => `  ? ${u}`)].join("\n")
}

function namespaceIn(command: string): string {
  if (!command) return ""
  if (ALL_NAMESPACES_FLAG.test(command)) return ALL_NAMESPACES
  const match = command.match(NAMESPACE_FLAG)
  if (!match?.groups?.value) return ""
  let value = match.groups.value.trim()
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

function parseKubectlTarget(command: string): Target | null {
  const match = command.match(K8S_DESTRUCTIVE)
  if (!match?.groups) return null

  const namespace = namespaceIn(command) || "default"
  const rest = match.groups.rest.split(/\s+/)
  const positional = rest.filter((token) => !token.startsWith("-")).filter((token) => token !== namespace)
  if (!positional.length) return null

  const first = positional[0]!
  if (first.includes("/")) {
    const [kind, name] = first.split("/", 2)
    return { kind: kind!, name: name ?? "", namespace }
  }
  if (positional.length >= 2) return { kind: first, name: positional[1]!, namespace }
  return { kind: first, name: "", namespace }
}

function kubectlJson(args: string[]): Promise<any | null> {
  return new Promise((resolve) => {
    execFile("kubectl", [...args, "-o", "json"], { timeout: 15_000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve(null)
      }
    })
  })
}

async function assessKubernetes(target: Target, verb: string): Promise<Assessment> {
  const findings: string[] = []
  const unknowns: string[] = []
  let headline: string
  let live: any = null

  if (target.namespace === ALL_NAMESPACES) {
    // kubectl refuses to fetch a named resource across all namespaces, so
    // there is no single object to describe. Saying "cluster unreachable"
    // here would be a lie about a command that is *wider* than usual.
    headline = `${verb} ${target.kind}/${target.name} in EVERY namespace`
    unknowns.push(
      "spans every namespace, so there is no one object to read — the count, the owners and the state below cannot be established for a command this wide",
    )
  } else {
    headline = `${verb} ${target.kind}/${target.name} in namespace ${target.namespace}`
    live = await kubectlJson(["get", target.kind, target.name, "-n", target.namespace])
    if (live === null) unknowns.push("could not read the live object — cluster unreachable or it doesn't exist")
  }

  if (live !== null) {
    const spec = live.spec ?? {}
    const status = live.status ?? {}
    const replicas = status.readyReplicas ?? status.replicas
    if (replicas !== undefined) {
      findings.push(`currently ${replicas} ready replica(s)`)
      if (replicas === 1) findings.push("only one replica — this removes the last instance")
    }

    const volumes: any[] = spec.template?.spec?.volumes ?? []
    const claims = volumes.filter((v) => "persistentVolumeClaim" in v)
    if (claims.length) findings.push(`holds state: ${claims.length} persistent volume claim(s) attached`)

    const owner = live.metadata?.labels?.["app.kubernetes.io/part-of"]
    if (owner) findings.push(`owned by ${owner}`)
  }

  // naki cross-references its own infra dependency map here; box doesn't
  // have that map ported yet, so this is said plainly rather than skipped.
  unknowns.push(
    "dependency map not available in this build — who else depends on this, and whether it's reachable from outside, could not be checked",
  )

  return { headline, findings, unknowns }
}

function assessCommand(command: string): Assessment | null {
  const match = command.match(K8S_DESTRUCTIVE)
  if (match?.groups) {
    const target = parseKubectlTarget(command)
    if (target?.name) return null // caller awaits assessKubernetes for this branch
    return {
      headline: `kubectl ${match.groups.verb} — target not named explicitly`,
      findings: [],
      unknowns: ["could not tell which object this hits; read the command carefully"],
    }
  }
  if (TERRAFORM_DESTRUCTIVE.test(command)) {
    return {
      headline: "terraform will change real infrastructure",
      findings: ["run `terraform plan` first and read it — apply/destroy acts on everything in state"],
      unknowns: ["scope depends on the current workspace and state file"],
    }
  }
  if (HELM_DESTRUCTIVE.test(command)) {
    return {
      headline: "helm will change a release",
      findings: ["every workload in the release is affected, not just the changed values"],
      unknowns: ["run `helm diff upgrade` first to see what actually changes"],
    }
  }
  return null
}

export default tool({
  description: `What a destructive action would actually take down: live replica count, attached persistent volumes, and whether it holds state. Call it before proposing a delete, scale to zero, drain, or terraform destroy — and when the user asks what happens if something goes away. Reports only what it could verify, and says what it couldn't.`,
  args: {
    command: tool.schema
      .string()
      .describe(
        "The exact command being considered, e.g. 'kubectl delete deployment checkout -n shop'. Use this when there is a concrete command.",
      )
      .optional(),
    service: tool.schema
      .string()
      .describe("A workload name, when the question is 'what if X went down' with no command.")
      .optional(),
    namespace: tool.schema.string().describe("Namespace for `service`. Defaults to 'default'.").optional(),
    kind: tool.schema.string().describe("Kubernetes kind for `service`. Defaults to 'deployment'.").optional(),
  },
  async execute(args, ctx) {
    const command = (args.command ?? "").trim()

    if (command) {
      const k8sMatch = command.match(K8S_DESTRUCTIVE)
      const target = k8sMatch ? parseKubectlTarget(command) : null
      if (k8sMatch && target?.name) {
        await ctx.ask({
          permission: "blast_radius",
          patterns: [`${target.kind}/${target.name}`],
          always: ["*"],
          metadata: { command },
        })
        const assessment = await assessKubernetes(target, k8sMatch.groups!.verb.toLowerCase())
        return { title: assessment.headline, output: render(assessment), metadata: { command } }
      }
      const assessment = assessCommand(command)
      if (!assessment) {
        return {
          title: command,
          output: `'${command}' isn't a command recognised as destructive, so there's no blast radius to report. That is not a guarantee it's safe — read it yourself.`,
          metadata: { command, recognized: false },
        }
      }
      await ctx.ask({ permission: "blast_radius", patterns: ["*"], always: ["*"], metadata: { command } })
      return { title: assessment.headline, output: render(assessment), metadata: { command } }
    }

    const service = (args.service ?? "").trim()
    if (!service) {
      return { title: "blast_radius", output: "Error: pass either `command` or `service`.", metadata: {} }
    }
    const target: Target = {
      kind: (args.kind || "deployment").trim(),
      name: service,
      namespace: (args.namespace || "default").trim(),
    }
    await ctx.ask({
      permission: "blast_radius",
      patterns: [`${target.kind}/${target.name}`],
      always: ["*"],
      metadata: { service, namespace: target.namespace, kind: target.kind },
    })
    const assessment = await assessKubernetes(target, "losing")
    return { title: assessment.headline, output: render(assessment), metadata: { service } }
  },
})
