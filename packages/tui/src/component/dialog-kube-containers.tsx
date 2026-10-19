import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { createResource, onMount } from "solid-js"
import { DialogKubeText } from "./dialog-kube-text"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_containers_level) — the containers of one pod, because `kubectl
// logs` needs -c the moment there is more than one, and picking the
// wrong one silently shows a sidecar's logs instead.
export function DialogKubeContainers(props: { namespace: string; pod: string }) {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [containers] = createResource(
    () => ({ namespace: props.namespace, pod: props.pod }),
    (query) =>
      sdk.client.experimental.kube.containers({ namespace: query.namespace, pod: query.pod }).then(
        (result) => result.data,
        () => undefined,
      ),
  )

  const options = () =>
    (containers() ?? []).map((c) => ({
      title: c.name,
      value: c.name,
      description: c.image,
    }))

  const viewLogs = (container: string, previous: boolean) =>
    kubeNavGo(dialog, () => (
      <DialogKubeText
        title={`${props.namespace}/${props.pod}/${container} — ${previous ? "previous logs" : "logs"}`}
        fetch={() =>
          sdk.client.experimental.kube
            .podLogs({ namespace: props.namespace, pod: props.pod, container, tail: "400", previous: previous ? "true" : undefined })
            .then((r) => r.data?.text ?? "")
        }
      />
    ))

  return (
    <DialogSelect
      title={`Kubernetes · ${props.pod} · Containers`}
      options={options()}
      emptyView={containers.loading ? <text>Loading…</text> : <text>No containers — the pod may have been deleted.</text>}
      onSelect={(option) => viewLogs(option.value, false)}
      actions={[
        {
          command: "kube.logs",
          title: "logs",
          onTrigger: (option) => viewLogs(option.value, false),
        },
        {
          command: "kube.logs.previous",
          title: "prev",
          onTrigger: (option) => viewLogs(option.value, true),
        },
      ]}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
