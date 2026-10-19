import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { KUBE_MOVE_CLOSE_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_node_pods_level) — everything scheduled on one node, across
// namespaces. The view you want when a node is under pressure.
export function DialogKubeNodePods(props: { node: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => props.node,
    (node) =>
      sdk.client.experimental.kube.table({ kind: "pods", node }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const options = () =>
    (table()?.rows ?? []).map((row, i) => ({
      title: row.cells[1] ?? row.key,
      value: `${row.key}-${i}`,
      description: row.cells.slice(2).join("  "),
      category: row.cells[0],
    }))

  return (
    <DialogSelect
      title={`Kubernetes · Pods on ${props.node}`}
      options={options()}
      emptyView={table.loading ? <text>Loading…</text> : <text>Nothing scheduled on {props.node}.</text>}
      onSelect={() => undefined}
      footerHints={KUBE_MOVE_CLOSE_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
