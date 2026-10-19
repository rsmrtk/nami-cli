import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubeNodePods } from "./dialog-kube-node-pods"
import { DialogKubeText } from "./dialog-kube-text"
import { DialogKubeEvents } from "./dialog-kube-events"
import { KUBE_NAV_REFRESH_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_nodes_level). `top` is offered even without metrics-server: the
// error kubectl returns says exactly what is missing.
export function DialogKubeNodes() {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table, { refetch }] = createResource(() =>
    sdk.client.experimental.kube.table({ kind: "nodes" }).then(
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
      title="Kubernetes · Nodes"
      options={options()}
      emptyView={table.loading ? <text>Loading nodes…</text> : <text>No nodes — is kubectl pointed at a cluster?</text>}
      onSelect={(option) => {
        kubeNavGo(dialog, () => <DialogKubeNodePods node={option.value} />)
      }}
      actions={[
        {
          command: "kube.describe",
          title: "desc",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`node/${option.value} — describe`}
                fetch={() => sdk.client.experimental.kube.describe({ kind: "node", name: option.value }).then((r) => r.data?.text ?? "")}
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
                title={`node/${option.value} — yaml`}
                fetch={() => sdk.client.experimental.kube.yaml({ kind: "node", name: option.value }).then((r) => r.data?.text ?? "")}
              />
            ))
          },
        },
        {
          command: "kube.top",
          title: "top",
          onTrigger: (option) => {
            kubeNavGo(dialog, () => (
              <DialogKubeText
                title={`node/${option.value} — top`}
                fetch={() => sdk.client.experimental.kube.top({ kind: "node", name: option.value }).then((r) => r.data?.text ?? "")}
              />
            ))
          },
        },
        {
          command: "kube.events",
          title: "events",
          onTrigger: () => {
            kubeNavGo(dialog, () => <DialogKubeEvents />)
          },
        },
      ]}
      footerHints={KUBE_NAV_REFRESH_HINTS}
      bindings={[
        { key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) },
        {
          key: "ctrl+r",
          desc: "Refresh",
          group: "Dialog",
          cmd: () => {
            void refetch()
          },
        },
      ]}
    />
  )
}
