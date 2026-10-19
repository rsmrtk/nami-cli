import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import { execFile } from "node:child_process"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CloudApiError,
  CloudResourcesQuery,
  ConsoleSwitchPayload,
  KubeApiError,
  KubeContainersQuery,
  KubeContextQuery,
  KubeDescribeQuery,
  KubePodLogsQuery,
  KubeTableQuery,
  KubeTopQuery,
  KubeYamlQuery,
  SessionListQuery,
  ToolListQuery,
  WorktreeApiError,
} from "../groups/experimental"

// Same NAKI_* env var names the ported AI tools use (~/.config/rsmrtk/tool/
// _shared/settings.ts) — naki's own domain config, unrelated to nami's own
// branding, so one env var works for both the tools and this panel.
const settings = {
  get prometheusUrl() {
    return process.env.NAKI_PROMETHEUS_URL ?? ""
  },
  get lokiUrl() {
    return process.env.NAKI_LOKI_URL ?? ""
  },
  get kubecostUrl() {
    return process.env.NAKI_KUBECOST_URL ?? ""
  },
}

// Ported from naki-cli (naki/agent/integrations.py). Every check runs
// live and cheaply — nothing here stores credentials, cloud CLIs keep
// their own, and reading status from a config file would report
// "connected" while an endpoint is actually down.

type IntegrationCheckStatus = "connected" | "not configured" | "unreachable" | "cli not installed"
type IntegrationCheckResult = { status: IntegrationCheckStatus; detail: string }

function runCliLine(cmd: string[], timeoutMs = 6_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd[0]!, cmd.slice(1), { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ code: 127, output: `${cmd[0]} not installed` })
        return
      }
      const output = (stdout || stderr || "").trim()
      resolve({ code: error ? ((error as any).code ?? 1) : 0, output: output.split("\n")[0] ?? "" })
    })
  })
}

async function httpCheck(url: string, path: string): Promise<IntegrationCheckResult> {
  if (!url) return { status: "not configured", detail: "" }
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}${path}`, { signal: AbortSignal.timeout(6_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { status: "connected", detail: url }
  } catch (exc: any) {
    return { status: "unreachable", detail: `${url}: ${exc.message}` }
  }
}

async function checkKubernetes(): Promise<IntegrationCheckResult> {
  const context = await runCliLine(["kubectl", "config", "current-context"])
  if (context.code === 127) return { status: "cli not installed", detail: "brew install kubectl" }
  if (context.code !== 0) return { status: "not configured", detail: "no kubeconfig context selected" }

  const nodes = await runCliLine(["kubectl", "get", "nodes", "--no-headers"], 10_000)
  if (nodes.code !== 0) return { status: "unreachable", detail: `${context.output}: ${nodes.output.slice(0, 60)}` }
  const count = nodes.output.split("\n").filter((l) => l.trim()).length || 1
  return { status: "connected", detail: `${context.output} (${count} node(s))` }
}

async function checkAws(): Promise<IntegrationCheckResult> {
  const r = await runCliLine(["aws", "sts", "get-caller-identity", "--output", "text", "--query", "Account"])
  if (r.code === 127) return { status: "cli not installed", detail: "brew install awscli" }
  if (r.code !== 0) return { status: "not configured", detail: "run: aws configure  (or aws sso login)" }
  return { status: "connected", detail: `account ${r.output}` }
}

async function checkGcp(): Promise<IntegrationCheckResult> {
  const r = await runCliLine(["gcloud", "config", "get-value", "project"])
  if (r.code === 127) return { status: "cli not installed", detail: "brew install --cask google-cloud-sdk" }
  if (r.code !== 0 || !r.output || r.output.startsWith("(")) {
    return { status: "not configured", detail: "run: gcloud auth login && gcloud config set project <id>" }
  }
  return { status: "connected", detail: `project ${r.output}` }
}

async function checkAzure(): Promise<IntegrationCheckResult> {
  const r = await runCliLine(["az", "account", "show", "--query", "name", "-o", "tsv"])
  if (r.code === 127) return { status: "cli not installed", detail: "brew install azure-cli" }
  if (r.code !== 0) return { status: "not configured", detail: "run: az login" }
  return { status: "connected", detail: r.output }
}

async function checkGithub(): Promise<IntegrationCheckResult> {
  const r = await runCliLine(["gh", "auth", "status"])
  if (r.code === 127) return { status: "cli not installed", detail: "brew install gh" }
  if (r.code !== 0) return { status: "not configured", detail: "run: gh auth login" }
  return { status: "connected", detail: r.output.slice(0, 60) }
}

async function checkKubecost(): Promise<IntegrationCheckResult> {
  if (!settings.kubecostUrl) return { status: "not configured", detail: "" }
  // Kubecost and OpenCost serve the same data at different paths, so the
  // check has to try both or it reports a working OpenCost as unreachable.
  let last: IntegrationCheckResult = { status: "unreachable", detail: "no allocation API answered" }
  for (const path of ["/model/allocation", "/allocation/compute", "/allocation"]) {
    const result = await httpCheck(settings.kubecostUrl, `${path}?window=1d`)
    if (result.status === "connected") {
      const flavour = path.startsWith("/model") ? "Kubecost" : "OpenCost"
      return { status: "connected", detail: `${flavour} at ${settings.kubecostUrl}` }
    }
    last = result
  }
  return last
}

async function integrationList() {
  const [kubernetes, aws, gcp, azure, prometheus, loki, kubecost, github] = await Promise.all([
    checkKubernetes(),
    checkAws(),
    checkGcp(),
    checkAzure(),
    httpCheck(settings.prometheusUrl, "/-/healthy"),
    httpCheck(settings.lokiUrl, "/ready"),
    checkKubecost(),
    checkGithub(),
  ])

  return [
    { key: "kubernetes", name: "Kubernetes", category: "cluster", hint: "kubectl config use-context <name>", ...kubernetes },
    { key: "aws", name: "AWS", category: "cloud", hint: "aws configure  ·  aws sso login", ...aws },
    { key: "gcp", name: "Google Cloud", category: "cloud", hint: "gcloud auth login", ...gcp },
    { key: "azure", name: "Azure", category: "cloud", hint: "az login", ...azure },
    { key: "prometheus", name: "Prometheus", category: "observability", hint: "set NAKI_PROMETHEUS_URL, e.g. http://localhost:9090", ...prometheus },
    { key: "loki", name: "Loki", category: "observability", hint: "set NAKI_LOKI_URL, e.g. http://localhost:3100", ...loki },
    {
      key: "kubecost",
      name: "Kubecost / OpenCost",
      category: "finops",
      hint: "set NAKI_KUBECOST_URL — OpenCost on :9003, Kubecost cost-analyzer on :9090",
      ...kubecost,
    },
    { key: "github", name: "GitHub (CI history)", category: "delivery", hint: "gh auth login", ...github },
  ]
}

// Shared by the three kube handlers below. kubectl's own stderr is already
// the readable error (the same text k8s_diagnose/blast_radius translate),
// so it is surfaced as-is rather than re-interpreted here.
//
// `context` picks one kubeconfig cluster without touching the user's current
// context. The `--context=<name>` form keeps a name that starts with "-" from
// being read as another flag.
function kubectl(args: string[], context?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("kubectl", context ? [`--context=${context}`, ...args] : args, { timeout: 20_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim().split("\n")[0] || "kubectl failed"))
        return
      }
      resolve(stdout)
    })
  })
}

// Ported from naki-cli (naki/agent/trees.py: _kubectl_table). Reads
// kubectl's own column header instead of hardcoding columns per kind —
// this is what lets one endpoint serve namespaces, nodes and all 14
// namespaced resource kinds. Column names are separated by two or more
// spaces (kubectl pads to the widest value), and a cell can itself
// contain a single space ("LAST SEEN" the header, "18 (20h ago)" a
// RESTARTS value) — so columns are sliced at the header's own offsets,
// not split on whitespace.
const HEADER_WORD = /^[A-Z][A-Z0-9 ()/._:-]*$/

function parseKubectlTable(output: string, maxColumns = 10): { columns: string[]; rows: { key: string; cells: string[] }[] } {
  const lines = output.split("\n").filter((line) => line.length > 0)
  if (!lines.length) return { columns: [], rows: [] }

  const headerMatches = [...lines[0]!.matchAll(/\S+(?: \S+)*/g)]
  const header = headerMatches.map((m) => m[0]!)
  if (!header.length || !header.every((name) => HEADER_WORD.test(name))) {
    // "No resources found in X namespace." and similar: not a table, not
    // an error — kubectl's own way of saying "nothing here."
    return { columns: [], rows: [] }
  }

  const offsets = headerMatches.map((m) => m.index!)
  const columns = header.slice(0, maxColumns).map((name) => name.toLowerCase())

  const rows: { key: string; cells: string[] }[] = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = header.map((_, i) => {
      const start = offsets[i]!
      const end = offsets[i + 1]
      return (end !== undefined ? line.slice(start, end) : line.slice(start)).trim()
    })
    if (!cells.length || !cells[0]) continue
    rows.push({ key: cells[0]!, cells: cells.slice(0, maxColumns) })
  }
  return { columns, rows }
}

async function kubeTableFor(query: { kind: string; namespace?: string; allNamespaces?: boolean; node?: string; context?: string }) {
  if (query.kind === "pods" && query.node) {
    const out = await kubectl(["get", "pods", "-A", "-o", "wide", "--field-selector", `spec.nodeName=${query.node}`], query.context)
    return parseKubectlTable(out)
  }
  if (query.kind === "events") {
    const scope = query.namespace ? ["-n", query.namespace] : ["-A"]
    const out = await kubectl(["get", "events", ...scope, "--sort-by=.lastTimestamp"], query.context)
    return parseKubectlTable(out)
  }
  const scope = query.namespace ? ["-n", query.namespace] : query.allNamespaces ? ["-A"] : []
  const out = await kubectl(["get", query.kind, ...scope], query.context)
  return parseKubectlTable(out)
}

function kubeDescribeFor(kind: string, name: string, namespace?: string, context?: string): Promise<string> {
  const args = ["describe", kind, name]
  if (namespace) args.push("-n", namespace)
  return kubectl(args, context)
}

function kubeTopFor(kind: "node" | "pod", name: string, namespace?: string, context?: string): Promise<string> {
  const args = ["top", kind, name]
  if (namespace) args.push("-n", namespace)
  return kubectl(args, context)
}

// Everything except secrets can be opened whole. `kubectl get secret -o
// yaml` prints the values (base64 is not encryption), and the rule here —
// same as naki's k8s_objects_level — is that a secret's existence and key
// names are visible, never its contents.
function kubeYamlFor(kind: string, name: string, namespace?: string, context?: string): Promise<string> {
  if (kind === "secrets" || kind === "secret") {
    return Promise.reject(new Error("Secret values are not shown — base64 is not encryption. Use describe to see key names and sizes."))
  }
  const args = ["get", kind, name, "-o", "yaml"]
  if (namespace) args.push("-n", namespace)
  return kubectl(args, context)
}

async function kubeContextFor(
  context?: string,
): Promise<{ context: string; cluster: string; user: string; server: string; version: string }> {
  const [view, version] = await Promise.all([
    kubectl(["config", "view", "--minify", "-o", "json"], context).catch(() => ""),
    kubectl(["version", "-o", "json"], context).catch(() => ""),
  ])
  const parse = (text: string): any => {
    try {
      return JSON.parse(text)
    } catch {
      return {}
    }
  }
  const config = parse(view)
  const current = config["current-context"] ?? ""
  const entry = config.contexts?.find((item: any) => item.name === current)?.context ?? {}
  const cluster = config.clusters?.find((item: any) => item.name === entry.cluster)?.cluster ?? {}
  return {
    context: String(current),
    cluster: String(entry.cluster ?? ""),
    user: String(entry.user ?? ""),
    server: String(cluster.server ?? ""),
    version: String(parse(version).serverVersion?.gitVersion ?? ""),
  }
}

// The cluster picker: every context in the kubeconfig. Nothing here talks to a
// cluster, so listing is instant even when some clusters are down.
async function kubeContextsFor(): Promise<
  { name: string; cluster: string; user: string; namespace: string; current: boolean }[]
> {
  const config = JSON.parse(await kubectl(["config", "view", "-o", "json"]).catch(() => "{}"))
  const current = String(config["current-context"] ?? "")
  return (config.contexts ?? []).map((item: any) => ({
    name: String(item.name),
    cluster: String(item.context?.cluster ?? ""),
    user: String(item.context?.user ?? ""),
    namespace: String(item.context?.namespace ?? ""),
    current: item.name === current,
  }))
}

async function kubeContainersFor(namespace: string, pod: string, context?: string): Promise<{ name: string; image: string }[]> {
  const out = await kubectl(
    ["get", "pod", pod, "-n", namespace, "-o", "jsonpath={range .spec.containers[*]}{.name} {.image}\n{end}"],
    context,
  )
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, image] = line.split(/\s+/)
      return { name: name ?? "?", image: image ?? "?" }
    })
}

async function cloudContextFor() {
  const identity = await awsJson(["sts", "get-caller-identity"]).catch(() => ({}) as Record<string, unknown>)
  const configured = await new Promise<string>((resolve) =>
    execFile("aws", ["configure", "get", "region"], { timeout: 10_000 }, (error, stdout) => resolve(error ? "" : stdout.trim())),
  )
  return {
    profile: process.env.AWS_PROFILE ?? "default",
    account: String(identity.Account ?? ""),
    identity: String(identity.Arn ?? ""),
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? configured,
  }
}

// Same shape of helper as kubectl() above, for the /cloud browser's AWS
// calls — a readable one-line error instead of a wall of CLI stderr.
function awsJson(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile("aws", [...args, "--output", "json"], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim().split("\n")[0] || "aws CLI failed"))
        return
      }
      try {
        resolve(JSON.parse(stdout || "{}"))
      } catch {
        reject(new Error("aws CLI returned output that isn't JSON"))
      }
    })
  })
}

// Ported from naki-cli (naki/agent/cloud_browser.py). Everything here is a
// list/describe call — acting on a row goes back through the model, where
// the permission ask still applies.

type CloudService = {
  key: string
  label: string
  command: string[] // aws CLI args, minus --output json
  path: string // dotted path into the response, "" meaning the response is the list, "a.b[]" exploding a nested array
  columns: [string, string][] // (header, field path within one item)
  noun: string
}

// Walks a dotted path, flattening any `[]` segment — "Reservations[].Instances[]"
// over the EC2 response yields every instance across every reservation.
function dig(obj: any, path: string): any[] {
  if (!path) return Array.isArray(obj) ? obj : [obj]

  let current: any[] = [obj]
  for (const segment of path.split(".")) {
    const explode = segment.endsWith("[]")
    const key = explode ? segment.slice(0, -2) : segment
    const next: any[] = []
    for (const item of current) {
      if (typeof item !== "object" || item === null) continue
      const value = item[key]
      if (value === undefined || value === null) continue
      if (explode && Array.isArray(value)) next.push(...value)
      else next.push(value)
    }
    current = next
  }

  const flattened: any[] = []
  for (const item of current) {
    if (Array.isArray(item)) flattened.push(...item)
    else flattened.push(item)
  }
  return flattened
}

// Single-value lookup for a column, tolerant of the field simply not being
// there — cloud responses vary by resource age and configuration.
function fieldValue(item: any, path: string): string {
  let current = item
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) current = current[0]
    if (typeof current !== "object" || current === null) return ""
    current = current[segment]
    if (current === undefined || current === null) return ""
  }
  if (Array.isArray(current)) return current.slice(0, 3).map(String).join(", ")
  return String(current)
}

const AWS_SERVICES: CloudService[] = [
  {
    key: "ec2",
    label: "EC2 instances",
    command: ["ec2", "describe-instances"],
    path: "Reservations[].Instances[]",
    columns: [
      ["id", "InstanceId"],
      ["type", "InstanceType"],
      ["state", "State.Name"],
      ["az", "Placement.AvailabilityZone"],
    ],
    noun: "EC2 instance",
  },
  {
    key: "eks",
    label: "EKS clusters",
    command: ["eks", "list-clusters"],
    path: "clusters",
    columns: [["name", ""]],
    noun: "EKS cluster",
  },
  {
    key: "s3",
    label: "S3 buckets",
    command: ["s3api", "list-buckets"],
    path: "Buckets",
    columns: [
      ["name", "Name"],
      ["created", "CreationDate"],
    ],
    noun: "S3 bucket",
  },
  {
    key: "rds",
    label: "RDS databases",
    command: ["rds", "describe-db-instances"],
    path: "DBInstances",
    columns: [
      ["id", "DBInstanceIdentifier"],
      ["engine", "Engine"],
      ["class", "DBInstanceClass"],
      ["status", "DBInstanceStatus"],
    ],
    noun: "RDS instance",
  },
  {
    key: "msk",
    label: "MSK (Kafka) clusters",
    command: ["kafka", "list-clusters"],
    path: "ClusterInfoList",
    columns: [
      ["name", "ClusterName"],
      ["state", "State"],
      ["kafka", "CurrentBrokerSoftwareInfo.KafkaVersion"],
    ],
    noun: "MSK cluster",
  },
  {
    key: "lambda",
    label: "Lambda functions",
    command: ["lambda", "list-functions"],
    path: "Functions",
    columns: [
      ["name", "FunctionName"],
      ["runtime", "Runtime"],
      ["memory", "MemorySize"],
    ],
    noun: "Lambda function",
  },
  {
    key: "elb",
    label: "Load balancers",
    command: ["elbv2", "describe-load-balancers"],
    path: "LoadBalancers",
    columns: [
      ["name", "LoadBalancerName"],
      ["type", "Type"],
      ["state", "State.Code"],
      ["scheme", "Scheme"],
    ],
    noun: "load balancer",
  },
  {
    key: "ebs",
    label: "EBS volumes",
    command: ["ec2", "describe-volumes"],
    path: "Volumes",
    columns: [
      ["id", "VolumeId"],
      ["size GiB", "Size"],
      ["state", "State"],
      ["type", "VolumeType"],
    ],
    noun: "EBS volume",
  },
  {
    key: "vpc",
    label: "VPCs",
    command: ["ec2", "describe-vpcs"],
    path: "Vpcs",
    columns: [
      ["id", "VpcId"],
      ["cidr", "CidrBlock"],
      ["state", "State"],
    ],
    noun: "VPC",
  },
]

function cloudServiceList() {
  return AWS_SERVICES.map((s) => ({ key: s.key, label: s.label, noun: s.noun }))
}

async function cloudResourceTable(serviceKey: string, region?: string): Promise<{ columns: string[]; rows: { key: string; cells: string[] }[] }> {
  const service = AWS_SERVICES.find((s) => s.key === serviceKey)
  if (!service) throw new Error(`Unknown cloud service '${serviceKey}'`)

  const scope = region ? ["--region", region] : []
  const payload = await awsJson([...service.command, ...scope])
  const items = dig(payload, service.path)

  const columns = service.columns.map(([header]) => header)
  const rows = items.map((item) => {
    const cells = service.columns.map(([, path]) => (path ? fieldValue(item, path) : String(item)))
    return { key: cells[0] || "?", cells }
  })
  return { columns, rows }
}

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const capabilities = Effect.fn("ExperimentalHttpApi.capabilities")(function* () {
      return { backgroundSubagents: flags.experimentalBackgroundSubagents }
    })

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      const all = yield* sessions.listGlobal({
        directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    const kubeTable = Effect.fn("ExperimentalHttpApi.kubeTable")(function* (ctx: {
      query: typeof KubeTableQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => kubeTableFor(ctx.query),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    const kubeDescribe = Effect.fn("ExperimentalHttpApi.kubeDescribe")(function* (ctx: {
      query: typeof KubeDescribeQuery.Type
    }) {
      const text = yield* Effect.tryPromise({
        try: () => kubeDescribeFor(ctx.query.kind, ctx.query.name, ctx.query.namespace, ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      return { text }
    })

    const kubeYaml = Effect.fn("ExperimentalHttpApi.kubeYaml")(function* (ctx: {
      query: typeof KubeYamlQuery.Type
    }) {
      const text = yield* Effect.tryPromise({
        try: () => kubeYamlFor(ctx.query.kind, ctx.query.name, ctx.query.namespace, ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      return { text }
    })

    const kubeTop = Effect.fn("ExperimentalHttpApi.kubeTop")(function* (ctx: {
      query: typeof KubeTopQuery.Type
    }) {
      const text = yield* Effect.tryPromise({
        try: () => kubeTopFor(ctx.query.kind, ctx.query.name, ctx.query.namespace, ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      return { text }
    })

    const kubeContext = Effect.fn("ExperimentalHttpApi.kubeContext")(function* (ctx: {
      query: typeof KubeContextQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => kubeContextFor(ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    const kubeContexts = Effect.fn("ExperimentalHttpApi.kubeContexts")(function* () {
      return yield* Effect.tryPromise({
        try: () => kubeContextsFor(),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    const kubeContainers = Effect.fn("ExperimentalHttpApi.kubeContainers")(function* (ctx: {
      query: typeof KubeContainersQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => kubeContainersFor(ctx.query.namespace, ctx.query.pod, ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    const kubePodLogs = Effect.fn("ExperimentalHttpApi.kubePodLogs")(function* (ctx: {
      query: typeof KubePodLogsQuery.Type
    }) {
      const args = ["logs", ctx.query.pod, "-n", ctx.query.namespace, "--tail", String(ctx.query.tail ?? 200)]
      if (ctx.query.container) args.push("-c", ctx.query.container)
      if (ctx.query.previous) args.push("--previous")
      const text = yield* Effect.tryPromise({
        try: () => kubectl(args, ctx.query.context),
        catch: (cause) => new KubeApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      return { text }
    })

    const integrations = Effect.fn("ExperimentalHttpApi.integrations")(function* () {
      return yield* Effect.promise(() => integrationList())
    })

    const cloudContext = Effect.fn("ExperimentalHttpApi.cloudContext")(function* () {
      return yield* Effect.promise(() => cloudContextFor())
    })

    const cloudServices = Effect.fn("ExperimentalHttpApi.cloudServices")(function* () {
      return cloudServiceList()
    })

    const cloudResources = Effect.fn("ExperimentalHttpApi.cloudResources")(function* (ctx: {
      query: typeof CloudResourcesQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => cloudResourceTable(ctx.query.service, ctx.query.region),
        catch: (cause) => new CloudApiError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    return handlers
      .handle("capabilities", capabilities)
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("resource", resource)
      .handle("kubeTable", kubeTable)
      .handle("kubeDescribe", kubeDescribe)
      .handle("kubeYaml", kubeYaml)
      .handle("kubeTop", kubeTop)
      .handle("kubeContext", kubeContext)
      .handle("kubeContexts", kubeContexts)
      .handle("kubeContainers", kubeContainers)
      .handle("kubePodLogs", kubePodLogs)
      .handle("cloudContext", cloudContext)
      .handle("cloudServices", cloudServices)
      .handle("cloudResources", cloudResources)
      .handle("integrations", integrations)
  }),
)
