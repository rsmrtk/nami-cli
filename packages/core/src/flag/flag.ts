import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["RSMRTK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["RSMRTK_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("RSMRTK_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  RSMRTK_AUTO_HEAP_SNAPSHOT: truthy("RSMRTK_AUTO_HEAP_SNAPSHOT"),
  RSMRTK_GIT_BASH_PATH: process.env["RSMRTK_GIT_BASH_PATH"],
  RSMRTK_CONFIG: process.env["RSMRTK_CONFIG"],
  RSMRTK_CONFIG_CONTENT: process.env["RSMRTK_CONFIG_CONTENT"],
  RSMRTK_DISABLE_AUTOUPDATE: truthy("RSMRTK_DISABLE_AUTOUPDATE"),
  RSMRTK_ALWAYS_NOTIFY_UPDATE: truthy("RSMRTK_ALWAYS_NOTIFY_UPDATE"),
  RSMRTK_DISABLE_PRUNE: truthy("RSMRTK_DISABLE_PRUNE"),
  RSMRTK_DISABLE_TERMINAL_TITLE: truthy("RSMRTK_DISABLE_TERMINAL_TITLE"),
  RSMRTK_SHOW_TTFD: truthy("RSMRTK_SHOW_TTFD"),
  RSMRTK_DISABLE_AUTOCOMPACT: truthy("RSMRTK_DISABLE_AUTOCOMPACT"),
  RSMRTK_DISABLE_MODELS_FETCH: truthy("RSMRTK_DISABLE_MODELS_FETCH"),
  RSMRTK_DISABLE_MOUSE: truthy("RSMRTK_DISABLE_MOUSE"),
  RSMRTK_FAKE_VCS: process.env["RSMRTK_FAKE_VCS"],
  RSMRTK_SERVER_PASSWORD: process.env["RSMRTK_SERVER_PASSWORD"],
  RSMRTK_SERVER_USERNAME: process.env["RSMRTK_SERVER_USERNAME"],
  RSMRTK_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("RSMRTK_DISABLE_FFF"),

  // Experimental
  RSMRTK_EXPERIMENTAL_FILEWATCHER: Config.boolean("RSMRTK_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  RSMRTK_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("RSMRTK_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  RSMRTK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("RSMRTK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  RSMRTK_MODELS_URL: process.env["RSMRTK_MODELS_URL"],
  RSMRTK_MODELS_PATH: process.env["RSMRTK_MODELS_PATH"],
  RSMRTK_DB: process.env["RSMRTK_DB"],

  RSMRTK_WORKSPACE_ID: process.env["RSMRTK_WORKSPACE_ID"],
  RSMRTK_EXPERIMENTAL_WORKSPACES: enabledByExperimental("RSMRTK_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get RSMRTK_DISABLE_PROJECT_CONFIG() {
    return truthy("RSMRTK_DISABLE_PROJECT_CONFIG")
  },
  get RSMRTK_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("RSMRTK_EXPERIMENTAL_REFERENCES")
  },
  get RSMRTK_TUI_CONFIG() {
    return process.env["RSMRTK_TUI_CONFIG"]
  },
  get RSMRTK_CONFIG_DIR() {
    return process.env["RSMRTK_CONFIG_DIR"]
  },
  get RSMRTK_PURE() {
    return truthy("RSMRTK_PURE")
  },
  get RSMRTK_PERMISSION() {
    return process.env["RSMRTK_PERMISSION"]
  },
  get RSMRTK_PLUGIN_META_FILE() {
    return process.env["RSMRTK_PLUGIN_META_FILE"]
  },
  get RSMRTK_CLIENT() {
    return process.env["RSMRTK_CLIENT"] ?? "cli"
  },
}
