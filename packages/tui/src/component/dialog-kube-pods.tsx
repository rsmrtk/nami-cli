import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubeContainers } from "./dialog-kube-containers"
import { DialogKubeText } from "./dialog-kube-text"
import { DialogKubeEvents } from "./dialog-kube-events"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_pods_level) — pods in one namespace, optionally filtered to one
// owner's own (the prefix a ReplicaSet names its pods with). Drills into
// the pod's containers, because `kubectl logs` needs -c the moment there
// is more than one.
export function DialogKubePods(props: { namespace: string; selector?: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => props.namespace,
    (namespace) =>
      sdk.client.experimental.kube.table({ kind: "pods", namespace }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const rows = () => {
    const all = table()?.rows ?? []
    return props.selector ? all.filter((row) => row.key.startsWith(`${props.selector}-`)) : all
  }

  const options = () =>
    rows().map((row) => ({
      title: row.key,
      value: row.key,
      description: row.cells.slice(1).join("  "),
    }))

  const title = props.selector ? `Kubernetes · ${props.namespace} · ${props.selector} · Pods` : `Kubernetes · ${props.namespace} · Pods`

  return (
    <DialogSelect
      title={title}
      options={options()}
      emptyView={table.loading ? <text>Loading pods…</text> : <text>No pods in {props.namespace}.</text>}
      onSelect={(option) => {
        kubeNavGo(dialog, () => <DialogKubeContainers namespace={props.namespace} pod={option.value} />)
      }}
      actions={[
        {
          command: "kube.logs",
          title: "logs",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`${props.namespace}/${option.value} — logs`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .podLogs({ namespace: props.namespace, pod: option.value, tail: "400" })
                    .then((r) => r.data?.text ?? "")
                }
              />
            ))
          },
        },
        {
          command: "kube.logs.previous",
          title: "prev",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`${props.namespace}/${option.value} — previous logs`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .podLogs({ namespace: props.namespace, pod: option.value, tail: "400", previous: "true" })
                    .then((r) => r.data?.text ?? "")
                }
              />
            ))
          },
        },
        {
          command: "kube.describe",
          title: "desc",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`pod/${option.value} — describe`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .describe({ kind: "pod", name: option.value, namespace: props.namespace })
                    .then((r) => r.data?.text ?? "")
                }
              />
            ))
          },
        },
        {
          command: "kube.yaml",
          title: "yaml",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`pod/${option.value} — yaml`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .yaml({ kind: "pod", name: option.value, namespace: props.namespace })
                    .then((r) => r.data?.text ?? "")
                }
              />
            ))
          },
        },
        {
          command: "kube.events",
          title: "events",
          onTrigger: () => {
            kubeNavGo(dialog, () => <DialogKubeEvents namespace={props.namespace} />)
          },
        },
      ]}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
