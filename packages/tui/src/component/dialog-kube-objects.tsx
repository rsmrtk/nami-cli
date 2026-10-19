import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubePods } from "./dialog-kube-pods"
import { DialogKubeText } from "./dialog-kube-text"
import { DialogKubeEvents } from "./dialog-kube-events"
import { KUBE_NAV_HINTS, KUBE_MOVE_CLOSE_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Kinds whose pods can be reached by name prefix (how a ReplicaSet names
// its own) — naki-cli's `_HAS_PODS`.
const HAS_PODS = new Set(["statefulsets", "daemonsets", "replicasets", "jobs"])

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_objects_level) — any namespaced resource kind, rendered from
// kubectl's own table. One level serves the rest of NAMESPACED_KINDS
// because the columns come from the header rather than a hardcoded
// per-kind shape.
export function DialogKubeObjects(props: { namespace: string; kind: string; label: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const isSecret = props.kind === "secrets"

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => ({ kind: props.kind, namespace: props.namespace }),
    (query) =>
      sdk.client.experimental.kube.table({ kind: query.kind, namespace: query.namespace }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const options = () =>
    (table()?.rows ?? []).map((row) => ({
      title: row.key,
      value: row.key,
      description: row.cells.slice(1).join("  "),
    }))

  const actions = [
    {
      command: "kube.describe",
      title: "desc",
      onTrigger: (option: { value: string }) => {
        kubeNavGo(dialog, () => (
          <DialogKubeText
            title={`${props.kind}/${option.value} — describe`}
            fetch={() => sdk.client.experimental.kube.describe({ kind: props.kind, name: option.value, namespace: props.namespace }).then((r) => r.data?.text ?? "")}
          />
        ))
      },
    },
    // Describe lists key names and sizes only, never values — the yaml
    // action is simply not offered for secrets, same as naki-cli.
    ...(isSecret
      ? []
      : [
          {
            command: "kube.yaml",
            title: "yaml",
            onTrigger: (option: { value: string }) => {
              kubeNavGo(dialog, () => (
                <DialogKubeText
                  title={`${props.kind}/${option.value} — yaml`}
                  fetch={() => sdk.client.experimental.kube.yaml({ kind: props.kind, name: option.value, namespace: props.namespace }).then((r) => r.data?.text ?? "")}
                />
              ))
            },
          },
        ]),
    {
      command: "kube.events",
      title: "events",
      onTrigger: () => {
        kubeNavGo(dialog, () => <DialogKubeEvents namespace={props.namespace} />)
      },
    },
  ]

  return (
    <DialogSelect
      title={`Kubernetes · ${props.namespace} · ${props.label}`}
      options={options()}
      emptyView={table.loading ? <text>Loading…</text> : <text>No {props.label} in {props.namespace}.</text>}
      onSelect={
        HAS_PODS.has(props.kind)
          ? (option) => kubeNavGo(dialog, () => <DialogKubePods namespace={props.namespace} selector={option.value} />)
          : () => undefined
      }
      actions={actions}
      footerHints={HAS_PODS.has(props.kind) ? KUBE_NAV_HINTS : KUBE_MOVE_CLOSE_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
