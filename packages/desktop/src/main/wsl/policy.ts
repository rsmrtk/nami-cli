import type { WslDistroProbe, WslRsmrtkCheck, WslServerItem } from "../../preload/types"

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  rsmrtkChecks: Record<string, WslRsmrtkCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextRsmrtkChecks = { ...rsmrtkChecks }
  delete nextDistroProbes[distro]
  delete nextRsmrtkChecks[distro]
  return { distroProbes: nextDistroProbes, rsmrtkChecks: nextRsmrtkChecks }
}

export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl", ...(distro ? ["-d", distro] : [])]
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}

export function requireWslIpcStrings(name: string, value: unknown) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}`)
  const values = value.map((item) => requireWslIpcString(name, item))
  if (values.length > 0) return values
  throw new Error(`Invalid ${name}`)
}
