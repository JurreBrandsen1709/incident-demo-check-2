#!/usr/bin/env node
// Seeds this repo instance with the incident this demo is built around: an
// upstream partner (ACME) silently changes their nightly export's date format,
// and our ingest job quietly drops every row instead of crashing. The only
// change to OUR code is a genuinely harmless one-line report-header tweak,
// disguised behind the same boring "cleanup" commit message a real innocent
// commit would carry. Run once per freshly generated template instance.

const { execSync } = require("child_process");
const fs = require("fs");

const PROGRAM_FILE = "app/src/ReconciliationJob/Program.cs";
const HEADER_LINE =
  '    Console.WriteLine($"Reconciliation report for window {fromUtc:yyyy-MM-dd HH:mm} UTC to {toUtc:yyyy-MM-dd HH:mm} UTC");';
const ANCHOR_LINE = "    IRecordStore store = RecordStore.FromCsvFile(fixturePath);";

const CURRENT_FIXTURE = "fixtures/partner-export-current.csv";
const BAD_FIXTURE = "fixtures/partner-export-bad.csv";
const SEED_STATE_FILE = "incident-log/seed-state.json";

const BRANCH = "seed/partner-export-format-change";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function applyInnocentChange() {
  const content = fs.readFileSync(PROGRAM_FILE, "utf8");
  if (content.includes(HEADER_LINE)) {
    throw new Error(
      `${PROGRAM_FILE} already has the report-header line. Has this instance already been seeded? ` +
        `Never run this against the template source repo itself.`
    );
  }
  if (!content.includes(ANCHOR_LINE)) {
    throw new Error(`Expected anchor line not found in ${PROGRAM_FILE}. Has the file changed shape?`);
  }
  fs.writeFileSync(PROGRAM_FILE, content.replace(ANCHOR_LINE, `${HEADER_LINE}\n\n${ANCHOR_LINE}`));
}

function swapInBadExport() {
  fs.copyFileSync(BAD_FIXTURE, CURRENT_FIXTURE);
}

function writeSeedState() {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();

  fs.writeFileSync(
    SEED_STATE_FILE,
    JSON.stringify(
      {
        simulated: true,
        note: "Timestamps below are simulated for demo narrative pacing (this script can be re-run per template instance, so the real commit timestamp won't line up with a fixed story timeline).",
        refactorCommitUtc: hoursAgo(18),
        upstreamChangeUtc: hoursAgo(11),
        upstreamChangeDescription: "ACME partner export format changed from YYYY-MM-DD to DD-MM-YYYY",
      },
      null,
      2
    ) + "\n"
  );
}

async function openPullRequest(repo, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: "refactor: clean up date formatting for the report header",
      head: BRANCH,
      base: "main",
      body: "Small cleanup pass through the reconciliation job's date handling. No behavior change intended.",
    }),
  });

  if (response.status !== 201) {
    throw new Error(`Failed to open PR: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function waitForChecks(repo, token, sha, attempts = 20, delayMs = 15000) {
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const { check_runs } = await response.json();

    if (check_runs.length === 0) {
      console.log(`No check runs reported yet (attempt ${i + 1}/${attempts})`);
    } else {
      const allCompleted = check_runs.every((c) => c.status === "completed");
      console.log(`Check runs: ${check_runs.map((c) => `${c.name}=${c.status}/${c.conclusion}`).join(", ")}`);
      if (allCompleted) {
        return check_runs.every((c) => c.conclusion === "success");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    console.error("GITHUB_REPOSITORY and GITHUB_TOKEN must be set.");
    process.exit(1);
  }

  run(`git checkout -b ${BRANCH}`);
  applyInnocentChange();
  swapInBadExport();
  writeSeedState();
  run(`git add ${PROGRAM_FILE} ${CURRENT_FIXTURE} ${SEED_STATE_FILE}`);
  run(`git commit -m "refactor: clean up date formatting for the report header"`);
  run(`git push origin ${BRANCH}`);

  const sha = execSync(`git rev-parse ${BRANCH}`, { encoding: "utf8" }).trim();
  const pr = await openPullRequest(repo, token);
  console.log(`Opened PR #${pr.number}: ${pr.html_url}`);

  const passed = await waitForChecks(repo, token, sha);
  if (!passed) {
    console.error("CI did not pass — resolve this before approving/merging the seed PR.");
    process.exit(1);
  }

  console.log(
    `CI passed. Review PR #${pr.number} yourself, then merge it before running the rest of the demo: ${pr.html_url}. ` +
      `No formal approval step — GitHub blocks a PR author from approving their own PR, and branch protection is configured with 0 required approvals for exactly that reason.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
