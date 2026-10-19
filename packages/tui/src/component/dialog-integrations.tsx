import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogCloudKinds } from "./dialog-cloud-kinds"
import { KUBE_NAV_REFRESH_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/integrations` command (naki/agent/
// integrations.py) — everything naki/nami can connect to, with a live
// status on each row, so you start from what you actually have rather
// than discovering a dead endpoint a level deeper. "Edit endpoint" (naki's
// "e" action, writing to ~/.naki/config.json) isn't ported — box reads
// these as NAKI_* env vars rather than a user-config file, so there's
// nothing in this build to write back to; set the env var and re-check.
export function DialogIntegrations() {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [list, { refetch }] = createResource(() =>
    sdk.client.experimental.integrations.list({}).then(
      (result) => result.data,
      () => undefined,
    ),
  )

  const options = () =>
    (list() ?? []).map((item) => ({
      title: item.name,
      value: item.key,
      category: item.category,
      description: item.detail ? `${item.status} — ${item.detail}` : `${item.status} — ${item.hint}`,
    }))

  return (
    <DialogSelect
      title="Integrations"
      options={options()}
      emptyView={list.loading ? <text>Checking…</text> : <text>Nothing to check.</text>}
      onSelect={(option) => {
        if (option.value === "aws") kubeNavGo(dialog, () => <DialogCloudKinds />)
      }}
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
