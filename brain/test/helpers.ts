import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Every tool reads its state from `.naki/` relative to the project root, so a
// test gets its own throwaway root instead of touching the real one.
export async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "nami-brain-"))
  await mkdir(path.join(root, ".naki"), { recursive: true })
  return {
    root,
    write: async (rel: string, body: string) => {
      const file = path.join(root, rel)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, body)
      return file
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

// Stands in for Prometheus: `ratios` maps a window ("30d", "5m") to the
// success ratio the server would report for a query over that window.
export function stubPrometheus(ratios: Record<string, number>) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any) => {
    const query = decodeURIComponent(new URL(String(input)).searchParams.get("query") ?? "")
    for (const [window, value] of Object.entries(ratios)) {
      if (query.includes(`[${window}:]`)) {
        return Response.json({ status: "success", data: { result: [{ value: [0, String(value)] }] } })
      }
    }
    return Response.json({ status: "success", data: { result: [] } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
