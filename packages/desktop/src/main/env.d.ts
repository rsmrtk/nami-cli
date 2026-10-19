interface ImportMetaEnv {
  readonly RSMRTK_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:rsmrtk-server" {
  export namespace Server {
    export const listen: typeof import("../../../rsmrtk/dist/types/src/node").Server.listen
    export type Listener = import("../../../rsmrtk/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../rsmrtk/dist/types/src/node").Config.get
    export type Info = import("../../../rsmrtk/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../rsmrtk/dist/types/src/node").bootstrap
}
