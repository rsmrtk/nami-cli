// Ported from naki-cli (naki/config.py). Env vars only here — box has no
// equivalent of naki's ~/.naki/config.json user-settings file, and these
// observability endpoints are exactly the kind of thing worth setting once
// per machine rather than per invocation.
//
// NAKI_* names are kept exactly as naki-cli used them: this is naki's own
// domain config (which Prometheus/Loki/Kubecost to talk to), unrelated to
// box/rsmrtk's own branding, so reusing the name means zero reconfiguration
// for anyone moving from naki-cli to box.
export const settings = {
  get prometheusUrl(): string {
    return process.env.NAKI_PROMETHEUS_URL ?? ""
  },
  get lokiUrl(): string {
    return process.env.NAKI_LOKI_URL ?? ""
  },
  get kubecostUrl(): string {
    return process.env.NAKI_KUBECOST_URL ?? ""
  },
}
