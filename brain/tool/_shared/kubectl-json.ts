import { execFile } from "node:child_process"

export function hasKubectl(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", ["kubectl"], (error) => resolve(!error))
  })
}

// Ported pattern from naki-cli's various `_kubectl_json`/`run_cli` helpers:
// a read-only `kubectl get ... -o json` call, (data, error) returned rather
// than thrown, with the error trimmed to something a reader can act on.
export function kubectlJson(args: string[], timeoutMs = 45_000): Promise<{ data: any | null; error: string }> {
  return new Promise((resolve) => {
    execFile("kubectl", [...args, "-o", "json"], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ data: null, error: "kubectl is not installed" })
          return
        }
        if ((error as any).killed) {
          resolve({ data: null, error: "kubectl timed out" })
          return
        }
        const first = (stderr || "").trim().split("\n")[0] ?? ""
        resolve({ data: null, error: first.slice(0, 140) || `kubectl exit ${(error as any).code ?? "?"}` })
        return
      }
      try {
        resolve({ data: JSON.parse(stdout), error: "" })
      } catch {
        resolve({ data: null, error: "kubectl returned output that isn't JSON" })
      }
    })
  })
}
