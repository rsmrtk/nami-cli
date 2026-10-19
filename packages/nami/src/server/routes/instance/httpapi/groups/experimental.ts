import { AccountID, OrgID } from "@/account/schema"
import { MCP } from "@/mcp"

import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Worktree } from "@/worktree"
import { NonNegativeInt } from "@rsmrtk/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"
import { ProviderV2 } from "@rsmrtk/core/provider"
import { ModelV2 } from "@rsmrtk/core/model"

const ConsoleStateResponse = Schema.Struct({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optionalKey(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })

const CapabilitiesResponse = Schema.Struct({
  backgroundSubagents: Schema.Boolean,
}).annotate({ identifier: "ExperimentalCapabilities" })

const ConsoleOrgOption = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
})

const ConsoleOrgList = Schema.Struct({
  orgs: Schema.Array(ConsoleOrgOption),
})

export const ConsoleSwitchPayload = Schema.Struct({
  accountID: AccountID,
  orgID: OrgID,
})

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: ProviderV2.ID,
  model: ModelV2.ID,
})

// Ported from naki-cli's /k8s browser (naki/agent/trees.py) — full
// navigation, not just the three headline levels: cluster entry (nodes /
// namespaces / events) → namespace → one of 14 resource kinds → pods
// (filtered by owner where that applies) → containers → logs, plus nodes
// → pods-on-that-node, plus describe/yaml/events as per-row actions.
// Read-only throughout, shells out to kubectl the same way k8s_diagnose
// and blast_radius do.
//
// One generic "table" endpoint serves every resource kind — namespaces,
// nodes, the 14 namespaced kinds, events, pods-on-a-node — because the
// columns come from kubectl's own header the same way trees.py's
// `_kubectl_table` reads them, rather than one schema per kind.
const KubeTableRow = Schema.Struct({ key: Schema.String, cells: Schema.Array(Schema.String) }).annotate({
  identifier: "KubeTableRow",
})
const KubeTable = Schema.Struct({
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(KubeTableRow),
}).annotate({ identifier: "KubeTable" })
export const KubeTableQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  // kubeconfig context (cluster) to run against; omitted = kubectl's current one.
  context: Schema.optional(Schema.String),
  // One of the 14 kinds in naki's NAMESPACED_KINDS, plus "namespaces",
  // "nodes" and "events" — kept as a free string rather than a literal
  // union so an unlisted kind (any CRD) still works via kubectl's own
  // table, same as trees.py never hardcodes beyond the menu it shows.
  kind: Schema.String,
  namespace: Schema.optional(Schema.String),
  allNamespaces: Schema.optional(QueryBoolean),
  // Pods scheduled on one node, cluster-wide — k8s_node_pods_level.
  node: Schema.optional(Schema.String),
})
export const KubeDescribeQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  // kubeconfig context (cluster) to run against; omitted = kubectl's current one.
  context: Schema.optional(Schema.String),
  kind: Schema.String,
  name: Schema.String,
  namespace: Schema.optional(Schema.String),
})
export const KubeYamlQuery = KubeDescribeQuery
// `kubectl top` only has node and pod variants — no namespace needed for a
// node, required for a pod. Kept its own query shape rather than reusing
// KubeDescribeQuery so a pod top can't be called without one.
export const KubeTopQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  // kubeconfig context (cluster) to run against; omitted = kubectl's current one.
  context: Schema.optional(Schema.String),
  kind: Schema.Literals(["node", "pod"]),
  name: Schema.String,
  namespace: Schema.optional(Schema.String),
})
const KubeText = Schema.Struct({ text: Schema.String }).annotate({ identifier: "KubeText" })
// What k9s prints in its header: the kubeconfig's current context, its cluster
// and user, and the server version. Every field is best-effort ("" when
// kubectl cannot say) so a half-configured kubeconfig still draws the header.
const KubeContext = Schema.Struct({
  context: Schema.String,
  cluster: Schema.String,
  user: Schema.String,
  server: Schema.String,
  version: Schema.String,
}).annotate({ identifier: "KubeContext" })
export const KubeContextQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  context: Schema.optional(Schema.String),
})
// One row of `kubectl config get-contexts`: what the cluster picker shows
// before any pod list, so several kubeconfig clusters can be told apart.
const KubeContextEntry = Schema.Struct({
  name: Schema.String,
  cluster: Schema.String,
  user: Schema.String,
  namespace: Schema.String,
  current: Schema.Boolean,
}).annotate({ identifier: "KubeContextEntry" })
const KubeContextList = Schema.Array(KubeContextEntry).annotate({ identifier: "KubeContextList" })
export const KubeContainersQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  // kubeconfig context (cluster) to run against; omitted = kubectl's current one.
  context: Schema.optional(Schema.String),
  namespace: Schema.String,
  pod: Schema.String,
})
const KubeContainer = Schema.Struct({ name: Schema.String, image: Schema.String }).annotate({
  identifier: "KubeContainer",
})
const KubeContainerList = Schema.Array(KubeContainer).annotate({ identifier: "KubeContainerList" })
export const KubePodLogsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  // kubeconfig context (cluster) to run against; omitted = kubectl's current one.
  context: Schema.optional(Schema.String),
  namespace: Schema.String,
  pod: Schema.String,
  container: Schema.optional(Schema.String),
  tail: Schema.optional(Schema.NumberFromString),
  // k9s_pods_level's "p" action — the crashed container's own last words,
  // which `kubectl logs --previous` is the only way to read.
  previous: Schema.optional(QueryBoolean),
})
const KubePodLogs = Schema.Struct({ text: Schema.String }).annotate({ identifier: "KubePodLogs" })
export class KubeApiError extends Schema.ErrorClass<KubeApiError>("KubeError")(
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

// Ported from naki-cli's /cloud browser (naki/agent/cloud_browser.py) —
// the real AWS service catalog (9 services: EC2, EKS, S3, RDS, MSK,
// Lambda, ELB, EBS, VPC), not a flattened guess at what's worth showing.
// Scoped to AWS only, same cut already made for the cost_diagnose/
// find_idle_resources/etc. AI tools: GCP (21 services) and Azure (6) each
// need gcloud/az-specific listing logic that hasn't been ported, and
// GCP's provider->project->service shape is a level naki itself only adds
// for that one cloud.
const CloudServiceInfo = Schema.Struct({ key: Schema.String, label: Schema.String, noun: Schema.String }).annotate({
  identifier: "CloudServiceInfo",
})
const CloudServiceList = Schema.Array(CloudServiceInfo).annotate({ identifier: "CloudServiceList" })
const CloudRow = Schema.Struct({ key: Schema.String, cells: Schema.Array(Schema.String) }).annotate({
  identifier: "CloudRow",
})
const CloudResourceTable = Schema.Struct({
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(CloudRow),
}).annotate({ identifier: "CloudResourceTable" })
export const CloudResourcesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  service: Schema.String,
  region: Schema.optional(Schema.String),
})
// What the /cloud header shows, k9s-style: which AWS profile, account, identity
// and region the CLI is using. Best-effort per field — "" when the CLI can't say.
const CloudContext = Schema.Struct({
  profile: Schema.String,
  account: Schema.String,
  identity: Schema.String,
  region: Schema.String,
}).annotate({ identifier: "CloudContext" })
export class CloudApiError extends Schema.ErrorClass<CloudApiError>("CloudError")(
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

// Ported from naki-cli's /integrations command (naki/agent/integrations.py)
// — everything naki can connect to, with a live status on each row, so you
// start from what you actually have rather than discovering a dead
// endpoint a level deeper. Checked fresh on every call, same as naki: a
// panel that reports "connected" from a cached value is useless the
// moment the endpoint goes down.
//
// Dropped from naki's own list: "ollama" (nami routes models through its
// own provider config, not a single base_url) and "backend" (naki's
// shared-journal server — nami has no equivalent to check).
export const IntegrationCheckStatus = Schema.Literals(["connected", "not configured", "unreachable", "cli not installed"])
const IntegrationCheckInfo = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  category: Schema.String,
  status: IntegrationCheckStatus,
  detail: Schema.String,
  hint: Schema.String,
}).annotate({ identifier: "IntegrationCheckInfo" })
const IntegrationCheckList = Schema.Array(IntegrationCheckInfo).annotate({ identifier: "IntegrationCheckList" })

const WorktreeList = Schema.Array(Schema.String)
const WorktreeErrorName = Schema.Union([
  Schema.Literal("WorktreeNotGitError"),
  Schema.Literal("WorktreeNameGenerationFailedError"),
  Schema.Literal("WorktreeCreateFailedError"),
  Schema.Literal("WorktreeStartCommandFailedError"),
  Schema.Literal("WorktreeRemoveFailedError"),
  Schema.Literal("WorktreeResetFailedError"),
  Schema.Literal("WorktreeListFailedError"),
])
export class WorktreeApiError extends Schema.ErrorClass<WorktreeApiError>("WorktreeError")(
  {
    name: WorktreeErrorName,
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}
export const SessionListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const ExperimentalPaths = {
  capabilities: "/experimental/capabilities",
  console: "/experimental/console",
  consoleOrgs: "/experimental/console/orgs",
  consoleSwitch: "/experimental/console/switch",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  sessionBackground: "/experimental/session/:sessionID/background",
  resource: "/experimental/resource",
  kubeTable: "/experimental/kube/table",
  kubeDescribe: "/experimental/kube/describe",
  kubeYaml: "/experimental/kube/yaml",
  kubeTop: "/experimental/kube/top",
  kubeContext: "/experimental/kube/context",
  kubeContexts: "/experimental/kube/contexts",
  kubeContainers: "/experimental/kube/containers",
  kubePodLogs: "/experimental/kube/pod/logs",
  cloudServices: "/experimental/cloud/services",
  cloudContext: "/experimental/cloud/context",
  cloudResources: "/experimental/cloud/resources",
  integrations: "/experimental/integrations",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("capabilities", ExperimentalPaths.capabilities, {
          query: WorkspaceRoutingQuery,
          success: described(CapabilitiesResponse, "Experimental capabilities"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.capabilities.get",
            summary: "Get experimental capabilities",
            description: "Get experimental features enabled on the Rsmrtk server.",
          }),
        ),
        HttpApiEndpoint.get("console", ExperimentalPaths.console, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleStateResponse, "Active Console provider metadata"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.get",
            summary: "Get active Console provider metadata",
            description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
          }),
        ),
        HttpApiEndpoint.get("consoleOrgs", ExperimentalPaths.consoleOrgs, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleOrgList, "Switchable Console orgs"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.listOrgs",
            summary: "List switchable Console orgs",
            description: "Get the available Console orgs across logged-in accounts, including the current active org.",
          }),
        ),
        HttpApiEndpoint.post("consoleSwitch", ExperimentalPaths.consoleSwitch, {
          query: WorkspaceRoutingQuery,
          payload: ConsoleSwitchPayload,
          success: described(Schema.Boolean, "Switch success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.switchOrg",
            summary: "Switch active Console org",
            description: "Persist a new active Console account/org selection for the current local Rsmrtk state.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          query: WorkspaceRoutingQuery,
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          success: described(WorktreeList, "List of worktree directories"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          disableCodecs: true,
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Worktree.CreateInput],
          success: described(Worktree.Info, "Worktree created"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all Rsmrtk sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.post("sessionBackground", ExperimentalPaths.sessionBackground, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Backgrounded subagents"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.background",
            summary: "Background subagents",
            description:
              "Detach any synchronous subagents currently blocking the session and continue them in the background.",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
        HttpApiEndpoint.get("kubeTable", ExperimentalPaths.kubeTable, {
          query: KubeTableQuery,
          success: described(KubeTable, "A kubectl get table for one resource kind"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.table",
            summary: "List Kubernetes resources of one kind",
            description:
              "Generic `kubectl get <kind>` table — namespaces, nodes, any of the 14 namespaced kinds, events, or pods filtered to one node. Columns come from kubectl's own header.",
          }),
        ),
        HttpApiEndpoint.get("kubeDescribe", ExperimentalPaths.kubeDescribe, {
          query: KubeDescribeQuery,
          success: described(KubeText, "kubectl describe output"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.describe",
            summary: "Describe a Kubernetes resource",
            description: "Same as `kubectl describe <kind> <name>`.",
          }),
        ),
        HttpApiEndpoint.get("kubeYaml", ExperimentalPaths.kubeYaml, {
          query: KubeYamlQuery,
          success: described(KubeText, "Resource manifest as YAML"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.yaml",
            summary: "Get a resource's YAML manifest",
            description:
              "Same as `kubectl get <kind> <name> -o yaml`. Refused for secrets — base64 is not encryption, so a secret's values are never shown; use describe for key names and sizes.",
          }),
        ),
        HttpApiEndpoint.get("kubeTop", ExperimentalPaths.kubeTop, {
          query: KubeTopQuery,
          success: described(KubeText, "kubectl top output"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.top",
            summary: "Show resource usage for a node or pod",
            description: "Same as `kubectl top node <name>` / `kubectl top pod <name> -n <namespace>`. Offered even without metrics-server: the error kubectl returns says exactly what's missing.",
          }),
        ),
        HttpApiEndpoint.get("kubeContext", ExperimentalPaths.kubeContext, {
          query: KubeContextQuery,
          success: described(KubeContext, "Current kubectl context"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.context",
            summary: "Show the current kubectl context",
            description: "Context, cluster, user, API server and server version — the header k9s draws above its table.",
          }),
        ),
        HttpApiEndpoint.get("kubeContexts", ExperimentalPaths.kubeContexts, {
          query: WorkspaceRoutingQuery,
          success: described(KubeContextList, "Kubeconfig contexts"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.contexts",
            summary: "List kubeconfig contexts",
            description: "Every context in the kubeconfig — the clusters /k8s can be pointed at — and which one kubectl currently uses.",
          }),
        ),
        HttpApiEndpoint.get("kubeContainers", ExperimentalPaths.kubeContainers, {
          query: KubeContainersQuery,
          success: described(KubeContainerList, "Containers in a pod"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.containers",
            summary: "List a pod's containers",
            description: "Name and image per container, so logs can be read with -c instead of guessing which one.",
          }),
        ),
        HttpApiEndpoint.get("kubePodLogs", ExperimentalPaths.kubePodLogs, {
          query: KubePodLogsQuery,
          success: described(KubePodLogs, "Pod logs"),
          error: KubeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.kube.podLogs",
            summary: "Get a pod's recent logs",
            description: "Tail logs for one pod/container, same as `kubectl logs`.",
          }),
        ),
        HttpApiEndpoint.get("cloudContext", ExperimentalPaths.cloudContext, {
          query: WorkspaceRoutingQuery,
          success: described(CloudContext, "Current AWS CLI profile, account and region"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.context",
            summary: "Show the current AWS context",
            description: "Profile, account, caller identity and region the aws CLI is using — the header the /cloud browser draws.",
          }),
        ),
        HttpApiEndpoint.get("cloudServices", ExperimentalPaths.cloudServices, {
          query: WorkspaceRoutingQuery,
          success: described(CloudServiceList, "AWS services in the /cloud catalog"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.services",
            summary: "List the AWS service catalog",
            description: "The services naki-cli's /cloud browser offers: EC2, EKS, S3, RDS, MSK, Lambda, ELB, EBS, VPC.",
          }),
        ),
        HttpApiEndpoint.get("cloudResources", ExperimentalPaths.cloudResources, {
          query: CloudResourcesQuery,
          success: described(CloudResourceTable, "Resources for one AWS service"),
          error: CloudApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.cloud.resources",
            summary: "List resources for one AWS service",
            description: "List resources for one catalog service (see cloudServices), via the aws CLI.",
          }),
        ),
        HttpApiEndpoint.get("integrations", ExperimentalPaths.integrations, {
          query: WorkspaceRoutingQuery,
          success: described(IntegrationCheckList, "Live status of everything naki/nami can connect to"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.integrations.list",
            summary: "Check connection status for every integration",
            description: "Kubernetes, AWS/GCP/Azure, Prometheus, Loki, Kubecost/OpenCost, GitHub — checked live, not from a cached config.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi read-only routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "rsmrtk experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
