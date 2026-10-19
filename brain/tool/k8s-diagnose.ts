import { tool } from "@rsmrtk/plugin"
import { execFile } from "node:child_process"

// Ported from naki-cli (naki/agent/tools/k8s_diagnose.py) — naki's own
// flagship tool, the most live-tested one it had. Logic kept faithful;
// the wiring is new (naki shelled out via Python subprocess with its own
// policy/evidence layer in front of it, this just runs kubectl directly
// through box's own permission ask).

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000 }, (error, stdout, stderr) => {
      const out = stdout.trim()
      if (error && (error as NodeJS.ErrnoException).killed) {
        resolve("(timed out after 20s)")
        return
      }
      if (error && (error as any).code === undefined && !stderr) {
        resolve(`(failed to run: ${error.message})`)
        return
      }
      if (error) {
        const err = stderr.trim()
        const translated = translate(err)
        if (translated !== err) {
          resolve(out ? `${out}\n${translated}`.trim() : translated)
          return
        }
        resolve(`${out}\n[exit ${(error as any).code ?? "?"}] ${err}`.trim())
        return
      }
      resolve(out || "(no output)")
    })
  })
}

// kubectl reports two ordinary situations as errors, and both land in the
// middle of a diagnosis the model then reads. A healthy pod's report
// carried "Error from server (BadRequest): previous terminated container
// not found", which says the container has never crashed — good news,
// written as a fault. Measured on naki's own failure lab: that string was
// the only thing in a healthy pod's diagnosis that looked like a problem.
const BENIGN_ERRORS: [string, string][] = [
  [
    "previous terminated container",
    "(no previous instance — this container has not restarted, so there is no earlier log)",
  ],
  [
    "Metrics API not available",
    "(no metrics-server in this cluster, so kubectl cannot report live usage here — ask for a Prometheus-backed metric instead if one is configured)",
  ],
  [
    "the server doesn't have a resource type",
    "(this cluster does not have that resource type — not an error about the object)",
  ],
]

function translate(text: string): string {
  for (const [needle, meaning] of BENIGN_ERRORS) {
    if (text.includes(needle)) return meaning
  }
  if (text.includes("couldn't get current server API group list") || text.includes("connection to the server")) {
    return `(cluster unreachable: ${text.split("\n")[0]})`
  }
  return text
}

function section(title: string, body: string): string {
  return `=== ${title} ===\n${body}`
}

// What a status unambiguously means, said once at the top so the reading
// does not depend on the model's own reasoning about it. From a real
// naki conversation: asked whether an OOM-killed workload was over- or
// under-provisioned, the agent answered "over-provisioned", reasoned
// correctly for three lines, then finished "it's under-provisioned" —
// contradicting itself in one answer. An OOM kill means exactly one of
// the two, so it is stated here instead of left to be inferred per call.
const STATUS_MEANINGS: [string, string][] = [
  [
    "OOMKilled",
    "the kernel killed this container for exceeding its memory limit. That makes it UNDER-provisioned: it needs more memory, not less. It is not a saving opportunity.",
  ],
  [
    "CreateContainerConfigError",
    "the container could never be created — something it references (a ConfigMap, Secret or volume) does not exist. Nothing about the application has run yet.",
  ],
  [
    "ImagePullBackOff",
    "the image could not be pulled: wrong name or tag, or credentials the node does not have. The application has not started, so its logs and usage say nothing.",
  ],
  ["ErrImagePull", "the image could not be pulled. The application has not started."],
  [
    "FailedScheduling",
    "no node can fit this pod as requested. This is about the requests it asks for versus the cluster's capacity, not about the application.",
  ],
  [
    "Evicted",
    "the node reclaimed resources and removed this pod. Look at the node's pressure conditions, not only at the pod.",
  ],
]

function interpretation(text: string): string {
  const found = STATUS_MEANINGS.filter(([status]) => text.includes(status)).map(
    ([status, meaning]) => `${status}: ${meaning}`,
  )
  if (!found.length) return ""
  return "=== what these statuses mean ===\n" + found.map((line) => `[rsmrtk] ${line}`).join("\n")
}

async function diagnosePod(name: string, namespace: string): Promise<string[]> {
  return [
    section(`describe pod/${name}`, await run("kubectl", ["describe", "pod", name, "-n", namespace])),
    section(
      `events involving ${name}`,
      await run("kubectl", [
        "get",
        "events",
        "-n",
        namespace,
        "--field-selector",
        `involvedObject.name=${name}`,
        "--sort-by",
        ".lastTimestamp",
      ]),
    ),
    section("logs (current, last 100 lines)", await run("kubectl", ["logs", name, "-n", namespace, "--tail=100"])),
    section(
      "logs (previous container instance, if it crashed)",
      await run("kubectl", ["logs", name, "-n", namespace, "--previous", "--tail=100"]),
    ),
    section("resource usage (needs metrics-server)", await run("kubectl", ["top", "pod", name, "-n", namespace])),
  ]
}

async function diagnoseDeployment(name: string, namespace: string): Promise<string[]> {
  return [
    section(
      `describe deployment/${name}`,
      await run("kubectl", ["describe", "deployment", name, "-n", namespace]),
    ),
    section(
      `events involving ${name}`,
      await run("kubectl", [
        "get",
        "events",
        "-n",
        namespace,
        "--field-selector",
        `involvedObject.name=${name}`,
        "--sort-by",
        ".lastTimestamp",
      ]),
    ),
    section(
      "rollout status",
      await run("kubectl", ["rollout", "status", `deployment/${name}`, "-n", namespace, "--timeout=5s"]),
    ),
    section(`pods in ${namespace} (filter for ${name} yourself)`, await run("kubectl", ["get", "pods", "-n", namespace])),
  ]
}

async function diagnoseNode(name: string): Promise<string[]> {
  return [
    section(`describe node/${name}`, await run("kubectl", ["describe", "node", name])),
    section("resource usage (needs metrics-server)", await run("kubectl", ["top", "node", name])),
  ]
}

export default tool({
  description: `Runs the standard read-only troubleshooting sequence against a Kubernetes resource (describe, recent events, logs, resource usage — the right subset per resource type) and returns it as one combined report. Prefer this over chaining individual kubectl calls by hand when troubleshooting a pod, deployment, or node — it always checks the same things a human would, in the right order, so nothing gets skipped.`,
  args: {
    resource_type: tool.schema.enum(["pod", "deployment", "node"]).describe("Kind of resource to diagnose."),
    name: tool.schema.string().describe("Resource name."),
    namespace: tool.schema
      .string()
      .describe("Namespace (ignored for node). Defaults to 'default'.")
      .optional(),
  },
  async execute(args, ctx) {
    await ctx.ask({
      permission: "k8s_diagnose",
      patterns: [`${args.resource_type}/${args.name}`],
      always: ["*"],
      metadata: { resource_type: args.resource_type, name: args.name, namespace: args.namespace },
    })

    const namespace = args.namespace || "default"
    let sections: string[]
    if (args.resource_type === "pod") sections = await diagnosePod(args.name, namespace)
    else if (args.resource_type === "deployment") sections = await diagnoseDeployment(args.name, namespace)
    else sections = await diagnoseNode(args.name)

    const body = sections.join("\n\n")
    const meaning = interpretation(body)
    const output = meaning ? `${meaning}\n\n${body}` : body

    return {
      title: `${args.resource_type}/${args.name}`,
      output,
      metadata: { resource_type: args.resource_type, name: args.name, namespace, oomKilled: body.includes("OOMKilled") },
    }
  },
})
