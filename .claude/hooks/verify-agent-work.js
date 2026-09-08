#!/usr/bin/env node
// Stop hook: before the incident-responder agent finishes, checks that it
// produced a PIR FILE (not PR-description text -- a real file in the diff),
// required for every branch including "infra failed"/"unknown" ones with no
// code fix. If it also changed app/src/, a regression test is required too.
// Blocks with a reason (Claude keeps working) rather than failing the job.
// An explicit "OVERRIDE: <reason>" line in the final message bypasses this,
// for the rare case where a test or PIR genuinely isn't warranted (e.g.
// coverage for this exact regression already exists -- name it explicitly
// in the override).
//
// Scoped to CI only (GITHUB_ACTIONS=true, set automatically by Actions
// runners): this hook exists to gate the incident-responder persona's
// automated runs in incident-agent.yml, not local Claude Code sessions
// doing general development on this repo. A local session's diff against
// origin/main will often carry unmerged app/src changes with no PIR for
// reasons that have nothing to do with incident response, and the check
// below is a whole-branch diff, not a per-turn one -- without this guard
// it would block every single Stop event in a local session, forever,
// until origin/main caught up.

const { execSync } = require("child_process");

function readStdin() {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  return new Promise((resolve) => {
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function changedFiles() {
  try {
    execSync("git fetch origin main --depth=50", { stdio: "ignore" });
  } catch {
    // best effort; the diff below still works if origin/main is already known
  }
  try {
    const out = execSync("git diff --name-only origin/main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    process.exit(0);
  }

  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    // malformed input -- fail open, don't block on our own parsing error
  }

  const lastMessage = input.last_assistant_message || "";
  if (/OVERRIDE:/i.test(lastMessage)) {
    process.exit(0);
  }

  const files = changedFiles();
  const codeChanged = files.some((f) => /^app\/src\/.*\.cs$/.test(f));
  const testsChanged = files.some((f) => /^app\/tests\/.*\.cs$/.test(f));
  const pirAdded = files.some((f) => /^incident-log\/PIR-.*\.md$/.test(f));

  const missing = [];
  if (!pirAdded) {
    missing.push(
      "a PIR file (call the Write tool with file_path set to exactly " +
        "incident-log/PIR-<today's date>.md and content based on incident-log/PIR-template.md " +
        "-- required for every branch, including infra-failed/unknown ones with no code fix; " +
        "a PR description or issue comment section is not a substitute, it must be a real file in the diff)"
    );
  }
  if (codeChanged && !testsChanged) {
    missing.push(
      "a new test under app/tests/ (via the Edit or Write tool -- add a [Fact] that " +
        "fails against the old, buggy code and passes against your fix)"
    );
  }

  if (missing.length === 0) {
    process.exit(0);
  }

  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        `Your work is still missing ${missing.join(" and ")}. ` +
        'If either genuinely isn\'t needed -- for example, an existing test by a specific ' +
        'name already fails against this exact regression -- explain why and include the ' +
        'literal line "OVERRIDE: <reason>" in your final message.',
    })
  );
}

main();
