// The data side of the k9s-style /k8s browser: command aliases, table parsing,
// sorting, filtering and the colour a row gets. No rendering here, so it can be
// tested without a terminal.

// k9s's layout, in a cooler palette: light blue and lilac instead of k9s's
// stock orange/aqua. The names are k9s's, the colours are ours.
export const K9S = {
  black: "#0d1017", // text drawn on a light background (cursor, crumbs) — the screen colour itself
  bg: "#0d1017", // the screen: box's own background
  white: "#cdd6f4", // values, column names
  orange: "#cba6f7", // header labels, logo, current crumb (lilac)
  orangeRed: "#f38ba8", // error rows, error flash
  darkOrange: "#f9e2af", // pending / not-ready rows
  dodger: "#74a8fc", // hotkeys, active frame
  sky: "#89b4fa", // frame, rows, cursor
  aqua: "#b4befe", // title, sort arrow, command frame
  fuchsia: "#d0a9f5", // namespace + <0>..<9> keys
  papaya: "#e0def4", // row count in the title
  cadet: "#a5b4fc", // prompt
  sea: "#cba6f7", // filter frame
  navajo: "#b4befe", // flash line
  slate: "#6c7086", // completed / empty
  purple: "#b4a0e5", // terminating
} as const

export type KindDef = {
  kind: string
  title: string
  aliases: string[]
  // Kinds whose pods can be reached by name prefix (how an owner names its own).
  hasPods?: boolean
}

// The 14 namespaced kinds of naki's /k8s menu first, in the same order, then the
// cluster-scoped ones k9s reaches by `:no`, `:ns`, `:pv` and friends.
export const KINDS: KindDef[] = [
  { kind: "pods", title: "Pods", aliases: ["po", "pod", "pods"] },
  { kind: "deployments", title: "Deployments", aliases: ["dp", "deploy", "deployment", "deployments"], hasPods: true },
  { kind: "statefulsets", title: "StatefulSets", aliases: ["sts", "statefulset", "statefulsets"], hasPods: true },
  { kind: "daemonsets", title: "DaemonSets", aliases: ["ds", "daemonset", "daemonsets"], hasPods: true },
  { kind: "replicasets", title: "ReplicaSets", aliases: ["rs", "replicaset", "replicasets"], hasPods: true },
  { kind: "jobs", title: "Jobs", aliases: ["job", "jobs"], hasPods: true },
  { kind: "cronjobs", title: "CronJobs", aliases: ["cj", "cronjob", "cronjobs"] },
  { kind: "services", title: "Services", aliases: ["svc", "service", "services"] },
  { kind: "ingresses", title: "Ingresses", aliases: ["ing", "ingress", "ingresses"] },
  { kind: "configmaps", title: "ConfigMaps", aliases: ["cm", "configmap", "configmaps"] },
  { kind: "secrets", title: "Secrets", aliases: ["sec", "secret", "secrets"] },
  { kind: "persistentvolumeclaims", title: "PersistentVolumeClaims", aliases: ["pvc", "persistentvolumeclaim", "persistentvolumeclaims"] },
  { kind: "serviceaccounts", title: "ServiceAccounts", aliases: ["sa", "serviceaccount", "serviceaccounts"] },
  { kind: "events", title: "Events", aliases: ["ev", "event", "events"] },
  { kind: "namespaces", title: "Namespaces", aliases: ["ns", "namespace", "namespaces"] },
  { kind: "nodes", title: "Nodes", aliases: ["no", "node", "nodes"] },
  { kind: "persistentvolumes", title: "PersistentVolumes", aliases: ["pv", "persistentvolume", "persistentvolumes"] },
  { kind: "storageclasses", title: "StorageClasses", aliases: ["sc", "storageclass", "storageclasses"] },
  { kind: "customresourcedefinitions", title: "CustomResourceDefinitions", aliases: ["crd", "crds", "customresourcedefinition", "customresourcedefinitions"] },
  // Not a kubectl kind: the kubeconfig's clusters, shown before any pod list.
  { kind: "contexts", title: "Contexts", aliases: ["ctx", "context", "contexts", "cluster", "clusters"] },
]

// The first 14 are what the namespace-level menu offers (naki's NAMESPACED_KINDS).
export const NAMESPACED_KINDS = KINDS.slice(0, 14)

// Resource kinds that live outside any namespace: they ignore the namespace
// hotkeys and k9s titles them `(all)`.
export const CLUSTER_SCOPED = new Set(["contexts", "namespaces", "nodes", "persistentvolumes", "storageclasses", "customresourcedefinitions"])

export function resolveKind(token: string): KindDef {
  const word = token.trim().toLowerCase()
  const found = KINDS.find((item) => item.aliases.includes(word))
  // Anything else goes to kubectl as-is, so a CRD (`:certificates`) just works.
  return found ?? { kind: word, title: word, aliases: [word] }
}

// Command-line completion for `:` — the full resource name first (`pods`,
// `deployments`), then a short alias. Returns only the missing tail, so the
// prompt can draw it dimmed after what was typed.
export function suggest(typed: string): string {
  const word = typed.trim().toLowerCase()
  if (!word || /\s/.test(typed.trim())) return ""
  for (const item of KINDS) {
    if (item.kind.startsWith(word) && item.kind !== word) return item.kind.slice(word.length)
  }
  for (const item of KINDS) {
    const hit = item.aliases.find((alias) => alias.startsWith(word) && alias !== word)
    if (hit) return hit.slice(word.length)
  }
  return ""
}

export type Row = { ns?: string; name: string; cells: string[] }
export type Table = { columns: string[]; rows: Row[] }

// The server returns kubectl's own table: with -A the first column is the
// namespace and the name is the second, otherwise the name leads.
export function toTable(input: { columns: readonly string[]; rows: readonly { key: string; cells: readonly string[] }[] }): Table {
  const columns = input.columns.map((column) => column.toUpperCase())
  const hasNs = columns[0] === "NAMESPACE"
  return {
    columns,
    rows: input.rows.map((row) => ({
      ns: hasNs ? row.cells[0] : undefined,
      name: hasNs ? (row.cells[1] ?? row.key) : row.key,
      // k9s shows the count alone; kubectl appends "(3h42m ago)".
      cells: row.cells.map((cell, i) => (columns[i] === "RESTARTS" ? (cell.split(" ")[0] ?? cell) : cell)),
    })),
  }
}

// "6d11h", "10d", "5m3s", "37s" → seconds. Anything unparsable sorts as 0.
export function ageSeconds(age: string): number {
  const unit: Record<string, number> = { y: 31536000, d: 86400, h: 3600, m: 60, s: 1 }
  let total = 0
  for (const match of age.matchAll(/(\d+)([ydhms])/g)) total += Number(match[1]) * unit[match[2]!]!
  return total
}

export type Sort = { column: string; desc: boolean }

export function defaultSort(columns: string[]): Sort {
  return { column: columns.includes("NAMESPACE") ? "NAMESPACE" : (columns[0] ?? "NAME"), desc: false }
}

export function sortRows(table: Table, sort: Sort): Row[] {
  const index = table.columns.indexOf(sort.column)
  if (index < 0) return table.rows
  const rows = [...table.rows]
  const sign = sort.desc ? -1 : 1
  const age = sort.column === "AGE"
  rows.sort((a, b) => {
    const left = a.cells[index] ?? ""
    const right = b.cells[index] ?? ""
    let order: number
    if (age) order = ageSeconds(left) - ageSeconds(right)
    else if (/^\d+$/.test(left) && /^\d+$/.test(right)) order = Number(left) - Number(right)
    else order = left.localeCompare(right, undefined, { numeric: true })
    // Ties fall back to name so the order stays stable between refreshes.
    return order !== 0 ? order * sign : a.name.localeCompare(b.name)
  })
  return rows
}

// `/text` keeps matching rows, `/!text` the rest. A pattern that isn't a valid
// regex is matched literally — same forgiveness k9s shows while you type.
export function filterRows(rows: Row[], filter: string): Row[] {
  if (!filter) return rows
  const inverse = filter.startsWith("!")
  const body = inverse ? filter.slice(1) : filter
  if (!body) return rows
  let test: (line: string) => boolean
  try {
    const pattern = new RegExp(body, "i")
    test = (line) => pattern.test(line)
  } catch {
    const needle = body.toLowerCase()
    test = (line) => line.toLowerCase().includes(needle)
  }
  return rows.filter((row) => test(row.cells.join(" ")) !== inverse)
}

const ERROR_STATUS = /(error|fail|backoff|crashloop|oomkilled|evicted|invalid|unknown|imageinspect|errimage)/i
const PENDING_STATUS = /(pending|creating|init:|podinitializing|containercreating|waiting)/i

// What colour a row is drawn in — k9s's stock skin: errors orange-red, pending
// dark orange, completed grey, terminating purple, everything else sky blue.
export function rowColor(table: Table, row: Row): string {
  const status = row.cells[table.columns.indexOf("STATUS")] ?? ""
  if (status) {
    if (/terminating/i.test(status)) return K9S.purple
    if (ERROR_STATUS.test(status)) return K9S.orangeRed
    if (PENDING_STATUS.test(status)) return K9S.darkOrange
    if (/(completed|succeeded)/i.test(status)) return K9S.slate
  }
  const ready = row.cells[table.columns.indexOf("READY")] ?? ""
  const fraction = /^(\d+)\/(\d+)$/.exec(ready)
  // Running but not every container ready yet.
  if (fraction && fraction[1] !== fraction[2]) return K9S.darkOrange
  return K9S.sky
}

export function isRightAligned(column: string): boolean {
  return column === "RESTARTS"
}


// YAML colours from the IntelliJ scheme "Ayu Dark copy" (colors/*.icls):
// YAML_SCALAR_KEY, YAML_SIGN, YAML_SCALAR_VALUE, YAML_SCALAR_STRING,
// DEFAULT_CONSTANT and DEFAULT_LINE_COMMENT, so a manifest reads the same here
// as it does in the editor.
export const YAML_COLORS = {
  key: "#70b0ff",
  sign: "#205ff1",
  value: "#84e176",
  string: "#4fd6be",
  constant: "#d2a6ff",
  comment: "#636a72",
  plain: "#cdd6f4",
} as const

export type Segment = { text: string; fg: string }

function yamlValue(value: string): Segment[] {
  if (!value) return []
  const hash = value.search(/\s#/)
  const quoted = /^["']/.test(value)
  if (hash > 0 && !quoted) return [...yamlValue(value.slice(0, hash)), { text: value.slice(hash), fg: YAML_COLORS.comment }]
  const bare = value.trim()
  if (quoted) return [{ text: value, fg: YAML_COLORS.string }]
  if (/^(true|false|null|~|yes|no)$/i.test(bare) || /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(bare)) return [{ text: value, fg: YAML_COLORS.constant }]
  if (/^[|>][-+0-9]*$/.test(bare) || /^[&*!]/.test(bare)) return [{ text: value, fg: YAML_COLORS.sign }]
  return [{ text: value, fg: YAML_COLORS.value }]
}

// One line of YAML as coloured segments. Line by line, no parser: enough for
// kubectl's block-style output (keys, `- ` items, scalars, comments).
export function yamlSegments(line: string): Segment[] {
  const head = /^(\s*)((?:-\s+)*)(.*)$/.exec(line)!
  const out: Segment[] = []
  if (head[1]) out.push({ text: head[1], fg: YAML_COLORS.plain })
  if (head[2]) out.push({ text: head[2], fg: YAML_COLORS.sign })
  const rest = head[3] ?? ""
  if (rest.startsWith("#")) return [...out, { text: rest, fg: YAML_COLORS.comment }]
  const key = /^("[^"]*"|'[^']*'|[^\s:#"'[\]{},][^:#]*?)(:)(?=\s|$)(\s*)(.*)$/.exec(rest)
  if (!key) return [...out, ...yamlValue(rest)]
  out.push({ text: key[1]!, fg: YAML_COLORS.key }, { text: key[2]!, fg: YAML_COLORS.sign })
  if (key[3]) out.push({ text: key[3], fg: YAML_COLORS.plain })
  return [...out, ...yamlValue(key[4] ?? "")]
}
