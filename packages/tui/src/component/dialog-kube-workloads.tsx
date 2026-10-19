import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubePods } from "./dialog-kube-pods"
import { DialogKubeText } from "./dialog-kube-text"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_workloads_level) — deployments in one namespace. Drills into the
// namespace's pods filtered to this deployment's own.
export function DialogKubeWorkloads(props: { namespace: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => props.namespace,
    (namespace) =>
      sdk.client.experimental.kube.table({ kind: "deployments", namespace }).then(
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

  return (
    <DialogSelect
      title={`Kubernetes · ${props.namespace} · Deployments`}
      options={options()}
      emptyView={table.loading ? <text>Loading…</text> : <text>No deployments in {props.namespace}.</text>}
      onSelect={(option) => {
        kubeNavGo(dialog, () => <DialogKubePods namespace={props.namespace} selector={option.value} />)
      }}
      actions={[
        {
          command: "kube.describe",
          title: "desc",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`deployment/${option.value} — describe`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .describe({ kind: "deployment", name: option.value, namespace: props.namespace })
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
                title={`deployment/${option.value} — yaml`}
                fetch={() =>
                  sdk.client.experimental.kube
                    .yaml({ kind: "deployment", name: option.value, namespace: props.namespace })
                    .then((r) => r.data?.text ?? "")
                }
              />
            ))
          },
        },
      ]}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
