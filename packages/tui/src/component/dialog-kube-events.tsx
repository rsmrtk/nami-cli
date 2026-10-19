import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { KUBE_MOVE_CLOSE_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_events_level) — newest last, same as kubectl's own sort, which is
// how events read during an incident.
export function DialogKubeEvents(props: { namespace?: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => props.namespace ?? "",
    (namespace) =>
      sdk.client.experimental.kube.table({ kind: "events", namespace: namespace || undefined }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const options = () =>
    (table()?.rows ?? []).map((row, i) => ({
      title: row.cells.slice(0, -1).join("  "),
      description: row.cells[row.cells.length - 1],
      value: `${row.key}-${i}`,
    }))

  const where = props.namespace ? ` in ${props.namespace}` : " (cluster-wide)"

  return (
    <DialogSelect
      title={`Kubernetes · Events${where}`}
      options={options()}
      emptyView={table.loading ? <text>Loading…</text> : <text>No events — the cluster has been quiet.</text>}
      onSelect={() => undefined}
      footerHints={KUBE_MOVE_CLOSE_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
