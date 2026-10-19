const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://nami.ai" : `https://${stage}.nami.ai`,
  console: stage === "production" ? "https://nami.ai/auth" : `https://${stage}.nami.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/nami",
  discord: "https://nami.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/v2/docs" },
  ],
}
