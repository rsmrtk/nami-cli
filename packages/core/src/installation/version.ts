declare global {
  const RSMRTK_VERSION: string
  const RSMRTK_CHANNEL: string
}

export const InstallationVersion = typeof RSMRTK_VERSION === "string" ? RSMRTK_VERSION : "local"
export const InstallationChannel = typeof RSMRTK_CHANNEL === "string" ? RSMRTK_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
