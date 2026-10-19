import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogKubeNodes } from "./dialog-kube-nodes"
import { DialogKubeNamespaces } from "./dialog-kube-namespaces"
import { DialogKubeEvents } from "./dialog-kube-events"
import { KUBE_NAV_HINTS } from "./kube-footer-hints"
import { kubeNavBack, kubeNavGo } from "./kube-nav"

const ENTRIES = [
  { title: "Nodes", value: "nodes", description: "the machines, and what is running on them" },
  { title: "Namespaces", value: "namespaces", description: "pods, workloads, config, secrets" },
  { title: "Events", value: "events", description: "what the cluster has been doing, cluster-wide" },
]

// Ported from naki-cli's `/k8s` command (naki/agent/trees.py:
// k8s_level) — the entry point into a cluster: the three things people
// actually start from, rather than opening straight on a resource list.
// Small on purpose: three plain rows and three footer hints (move/open/
// close) fit the default dialog width fine — no need for the extra room
// the deeper, action-heavy levels get.
export function DialogKubeCluster() {
  const dialog = useDialog()

  return (
    <DialogSelect
      title="Kubernetes"
      options={ENTRIES}
      onSelect={(option) => {
        if (option.value === "nodes") kubeNavGo(dialog, () => <DialogKubeNodes />)
        else if (option.value === "namespaces") kubeNavGo(dialog, () => <DialogKubeNamespaces />)
        else kubeNavGo(dialog, () => <DialogKubeEvents />)
      }}
      footerHints={KUBE_NAV_HINTS}
      bindings={[{ key: "escape", desc: "Back", group: "Dialog", cmd: () => kubeNavBack(dialog) }]}
    />
  )
}
