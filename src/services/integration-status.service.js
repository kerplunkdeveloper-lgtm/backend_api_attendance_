const providers = [
  { key: "google", name: "Google Workspace", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], capabilities: ["calendar", "directory", "sso"] },
  { key: "microsoft", name: "Microsoft 365 / Teams", env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"], capabilities: ["calendar", "teams", "directory", "sso"] },
  { key: "slack", name: "Slack", env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"], capabilities: ["notifications", "approvals", "webhooks"] },
  { key: "biometric", name: "Biometric device gateway", env: ["BIOMETRIC_WEBHOOK_SECRET"], capabilities: ["punch-ingest", "device-events"] },
];

function integrationStatus() {
  return providers.map((provider) => {
    const configured = provider.env.filter((key) => Boolean(process.env[key]));
    return {
      key: provider.key,
      name: provider.name,
      status: configured.length === provider.env.length ? "CONFIGURED" : configured.length ? "PARTIAL" : "NOT_CONFIGURED",
      configuredKeys: configured,
      requiredKeys: provider.env,
      capabilities: provider.capabilities,
      activation: configured.length === provider.env.length ? "Ready for provider-specific consent/webhook setup." : "Add the required server-side credentials before activation.",
    };
  });
}

module.exports = { integrationStatus };
