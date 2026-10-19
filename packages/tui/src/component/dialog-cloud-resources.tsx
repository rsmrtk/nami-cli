import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { KUBE_MOVE_CLOSE_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/cloud` command (naki/agent/trees.py:
// resources_level) — the actual resources for one service. Read-only:
// acting on something goes back through the agent, where the permission
// ask still applies.
export function DialogCloudResources(props: { service: string; title: string; noun: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [table] = createResource(
    () => props.service,
    (service) =>
      sdk.client.experimental.cloud.resources({ service }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const options = () =>
    (table()?.rows ?? []).map((row, i) => ({
      title: row.cells[0] || row.key,
      value: `${row.key}-${i}`,
      description: row.cells.slice(1).join("  "),
    }))

  return (
    <DialogSelect
      title={`Cloud · ${props.title}`}
      options={options()}
      emptyView={
        table.loading ? (
          <text>Loading…</text>
        ) : (
          <text>No {props.noun}s found — check `aws` is installed and authenticated (aws sts get-caller-identity).</text>
        )
      }
      onSelect={() => undefined}
      footerHints={KUBE_MOVE_CLOSE_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
