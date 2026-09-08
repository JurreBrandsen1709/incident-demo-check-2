#!/usr/bin/env node
// Simulates the one component of this pipeline that isn't real: the
// Azure Application Insights anomaly alert -> Action Group -> webhook.
// Everything downstream of the repository_dispatch call below is real.

const observedValue = Number(process.argv[2] ?? "0");
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repo || !token) {
  console.error("GITHUB_REPOSITORY and GITHUB_TOKEN must be set.");
  process.exit(1);
}

const alert = {
  metric: "records_processed",
  observed: observedValue,
  expectedRange: [4, 6],
  timestampUtc: new Date().toISOString(),
  source: "simulated-app-insights",
};

async function main() {
  const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: "anomaly-detected",
      client_payload: alert,
    }),
  });

  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(`repository_dispatch failed: ${response.status} ${body}`);
  }

  console.log(`Fired anomaly-detected dispatch: ${JSON.stringify(alert)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
