/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://nami.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/nami",
    starsFormatted: {
      compact: "208K",
      full: "208,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/nami",
    discord: "https://discord.gg/nami",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
