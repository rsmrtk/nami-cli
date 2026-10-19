import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogCloudResources } from "./dialog-cloud-resources"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/cloud` command (naki/agent/cloud_browser.py:
// AWS service catalog) — AWS only, see groups/experimental.ts for the
// scope cut and why GCP/Azure aren't here.
export function DialogCloudKinds() {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [services] = createResource(() =>
    sdk.client.experimental.cloud.services({}).then(
      (result) => result.data,
      () => undefined,
    ),
  )

  const options = () =>
    (services() ?? []).map((s) => ({
      title: s.label,
      value: s.key,
      description: s.noun,
    }))

  return (
    <DialogSelect
      title="Cloud · AWS"
      options={options()}
      emptyView={services.loading ? <text>Loading…</text> : <text>No services — is the aws CLI installed?</text>}
      onSelect={(option) => {
        const service = services()!.find((s) => s.key === option.value)!
        kubeNavGo(dialog, () => <DialogCloudResources service={service.key} title={service.label} noun={service.noun} />)
      }}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
