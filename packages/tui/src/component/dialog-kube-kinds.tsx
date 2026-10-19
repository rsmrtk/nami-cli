import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { onMount } from "solid-js"
import { DialogKubeWorkloads } from "./dialog-kube-workloads"
import { DialogKubePods } from "./dialog-kube-pods"
import { DialogKubeEvents } from "./dialog-kube-events"
import { DialogKubeObjects } from "./dialog-kube-objects"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_kinds_level, NAMESPACED_KINDS). Static and cheap on purpose:
// counting each kind would be fourteen kubectl calls to draw a menu.
const NAMESPACED_KINDS: { kind: string; label: string }[] = [
  { kind: "pods", label: "pods" },
  { kind: "deployments", label: "deployments" },
  { kind: "statefulsets", label: "statefulsets" },
  { kind: "daemonsets", label: "daemonsets" },
  { kind: "replicasets", label: "replicasets" },
  { kind: "jobs", label: "jobs" },
  { kind: "cronjobs", label: "cronjobs" },
  { kind: "services", label: "services" },
  { kind: "ingresses", label: "ingresses" },
  { kind: "configmaps", label: "configmaps" },
  { kind: "secrets", label: "secrets" },
  { kind: "persistentvolumeclaims", label: "pvcs" },
  { kind: "serviceaccounts", label: "service accounts" },
  { kind: "events", label: "events" },
]

export function DialogKubeKinds(props: { namespace: string }) {
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = NAMESPACED_KINDS.map((k) => ({
    title: k.label === k.kind ? k.label : `${k.label} (${k.kind})`,
    value: k.kind,
  }))

  return (
    <DialogSelect
      title={props.namespace}
      options={options}
      onSelect={(option) => {
        const kind = option.value
        const entry = NAMESPACED_KINDS.find((k) => k.kind === kind)!
        if (kind === "deployments") {
          kubeNavGo(dialog, () => <DialogKubeWorkloads namespace={props.namespace} />)
        } else if (kind === "pods") {
          kubeNavGo(dialog, () => <DialogKubePods namespace={props.namespace} />)
        } else if (kind === "events") {
          kubeNavGo(dialog, () => <DialogKubeEvents namespace={props.namespace} />)
        } else {
          kubeNavGo(dialog, () => <DialogKubeObjects namespace={props.namespace} kind={entry.kind} label={entry.label} />)
        }
      }}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
