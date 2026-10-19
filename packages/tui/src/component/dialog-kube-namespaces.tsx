import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubeKinds } from "./dialog-kube-kinds"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_namespaces_level) — drills into DialogKubeKinds, the menu of
// resource kinds inside that namespace.
export function DialogKubeNamespaces() {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(() =>
    sdk.client.experimental.kube.table({ kind: "namespaces" }).then(
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
      title="Kubernetes · Namespaces"
      options={options()}
      emptyView={table.loading ? <text>Loading namespaces…</text> : <text>No namespaces found — is kubectl installed and pointed at a cluster?</text>}
      onSelect={(option) => {
        kubeNavGo(dialog, () => <DialogKubeKinds namespace={option.value} />)
      }}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
