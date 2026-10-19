// @ts-nocheck

import { Rsmrtk } from "@rsmrtk/core"
import { ReadTool } from "@rsmrtk/core/tools"

const rsmrtk = Rsmrtk.make({})

rsmrtk.tool.add(ReadTool)

rsmrtk.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

rsmrtk.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

rsmrtk.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await rsmrtk.session.create({
  agent: "build",
})

rsmrtk.subscribe((event) => {
  console.log(event)
})

await rsmrtk.session.prompt({
  sessionID,
  text: "hey what is up",
})

await rsmrtk.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await rsmrtk.session.wait()

console.log(await rsmrtk.session.messages(sessionID))
