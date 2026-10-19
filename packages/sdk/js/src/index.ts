export * from "./client.js"
export * from "./server.js"

import { createRsmrtkClient } from "./client.js"
import { createRsmrtkServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createRsmrtk(options?: ServerOptions) {
  const server = await createRsmrtkServer({
    ...options,
  })

  const client = createRsmrtkClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
