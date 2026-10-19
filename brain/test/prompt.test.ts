import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

// The agent prompts are code: they name tools, and a prompt that names a tool
// that does not exist sends the model into calls that can only fail.

const root = path.resolve(import.meta.dir, "..")
const agents = ["build", "sre", "finops"]
const tools = async () => (await readdir(path.join(root, "tool"))).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""))
const prompt = (name: string) => readFile(path.join(root, "agent", `${name}.md`), "utf-8")

describe("agent prompts", () => {
  test("every custom tool the main prompt names exists", async () => {
    const available = new Set(await tools())
    const body = await prompt("build")
    const named = [...body.matchAll(/^- ([a-z0-9-]+)(?: \/ ([a-z0-9-]+))?:/gm)].flatMap((m) => [m[1]!, m[2]].filter(Boolean) as string[])
    expect(named.length).toBeGreaterThan(10)
    for (const name of named) expect(available.has(name), `${name} is named in the prompt but has no tool`).toBe(true)
  })

  test("every tool a role switches off exists, so a typo cannot leave one on", async () => {
    const available = new Set([...(await tools()), "write", "edit", "todowrite", "task", "skill"])
    for (const name of ["sre", "finops"]) {
      const front = (await prompt(name)).split("---")[1]!
      for (const [, tool] of front.matchAll(/^ {2}([a-z0-9-]+): false/gm)) expect(available.has(tool!), `${name}: ${tool}`).toBe(true)
    }
  })

  test.each(agents)("%s states its real access and refuses to under-claim it", async (name) => {
    expect(await prompt(name)).toMatch(/never say you cannot access|You CAN run kubectl/)
  })

  test.each(agents)("%s says not to ask the user what a command can tell", async (name) => {
    expect(await prompt(name)).toMatch(/Never ask the user for something a command can tell you|never ask the user for something a command can tell you|never ask a question whose answer/i)
  })

  test("the main prompt defines when asking is allowed and forbids tool markup as text", async () => {
    const body = await prompt("build")
    expect(body).toContain("Ask the user only at a real fork")
    expect(body).toContain("never write tool-call markup")
  })

  test("the main prompt makes arithmetic a command, not an estimate", async () => {
    expect(await prompt("build")).toContain("compute it with a command and show the arithmetic")
  })

  test("the prompt stays small — every token is prefilled on each new session", async () => {
    const words = (await prompt("build")).split(/\s+/).length
    expect(words).toBeLessThan(2000)
  })
})
