# Agentic Incident Response — Demo

Backs the "Agentic Incident Response" talk (ISKS 2026). Everything here is
real and runnable except one thing: the Azure Application Insights anomaly
alert, which is simulated by `scripts/simulate-alert.js`. Nothing downstream
of that simulated trigger is faked — no vendor SRE platform, no live Azure
subscription required.

## The scenario

Most real incidents aren't caused by our own code — they're caused by
something upstream changing shape, or infrastructure failing. This demo is
built to make an agent prove that, rather than just confirm the one obvious
recent commit.

- **Day 1, 07:41** — a developer merges `refactor: clean up date formatting
  for the report header`, a genuinely harmless one-line change to a report
  header string in `Program.cs`. It touches nothing on the ingest/parsing
  path. Passes review, passes CI. This commit is completely innocent — it's
  the red herring.
- **Day 1, ~15:00** — an upstream partner ("ACME") upgrades a library on
  their side. Their nightly export's date format silently changes from ISO
  `2026-08-28` to `28-08-2026`. We have no visibility into this and no
  notification.
- **Day 2, 01:45** — ACME's nightly export runs and produces the first file
  in the new format.
- **Day 2, 02:00** — our ingest job runs. Every row fails date parsing
  against `RecordStore.AcceptedDateFormats` and is silently filtered out.
  The job **completes successfully with exit code 0 and processes zero
  records.** No exception, no crash, no error log.
- **Day 2, 02:03** — an alert fires on `records_processed == 0`.

The gap is deliberate: the upstream cause happened ~11 hours before the
symptom, and the innocent commit happened ~18 hours before. Naive
time-correlation points at the commit. The agent has to do better than that
— see "Why the agent can't just go look" below for how.

The live/reproducible pipeline can't backdate a real git commit to a fixed
calendar timeline (the seed step can run at any time, and may run more than
once across template instances), so it approximates this timeline with
simulated relative offsets (commit at T-18h, upstream change at T-11h) — see
`incident-log/seed-state.json`, written by the seed step and rendered,
clearly labeled `(simulated)`, in the pre-triage issue's Timeline section.

## Use this template

Click "Use this template" on GitHub, or:

```bash
gh repo create <you>/incident-demo-<instance> --public \
  --template JurreBrandsen1709/agentic-incident-response-demo --clone
```

Each generated instance needs its own secrets (not copied by template
generation):

```bash
gh secret set ANTHROPIC_API_KEY --repo <you>/incident-demo-<instance>
gh secret set DEMO_PAT --repo <you>/incident-demo-<instance>
```

`DEMO_PAT` is a fine-grained personal access token scoped to that repo only,
with Contents/Issues/Pull requests set to Read and write. It's required
because GitHub Actions does not start new workflow runs for events triggered
by the default `GITHUB_TOKEN` (except `workflow_dispatch` and
`repository_dispatch`) — this repo's pre-triage and seeding steps need to
trigger other workflows, so they use `DEMO_PAT` instead.

Re-apply branch protection on the new instance's `main` (see "Verifying a
fresh instance end-to-end" below) — template generation does not copy
branch protection rules.

## Run it

1. Seed the incident (once per instance):
   ```bash
   gh workflow run seed.yml --repo <you>/incident-demo-<instance>
   ```
   Opens a PR titled `refactor: clean up date formatting for the report
   header` that adds the harmless header line, swaps the active partner
   export to the bad-date-format fixture, and writes
   `incident-log/seed-state.json`. Wait for it to report that CI passed,
   then review the diff and merge it yourself. There's no formal approval
   step — GitHub blocks a PR author from approving their own PR, and branch
   protection is configured with 0 required approvals for exactly that
   reason.

2. Trigger the incident:
   ```bash
   gh workflow run nightly-job.yml --repo <you>/incident-demo-<instance>
   ```
   Runs the reconciliation job against `fixtures/partner-export-current.csv`
   (now the bad-format export), observes `records_processed: 0`, and fires a
   simulated anomaly alert.

3. Watch: a curated Issue appears, labeled `incident:triage-ready`. The
   agent (`claude-code-action`) picks it up automatically — no human clicks
   "assign" — investigates, posts an evidence-first analysis as an issue
   comment, and opens a PR with a fix, a new regression test, and a
   filled-in post-incident review at `incident-log/PIR-<date>.md`.

4. Review and merge that PR yourself. Re-run `nightly-job.yml` to confirm
   the job resolves (`records_processed: 5`, not `0`) — the incident is
   closed, not just the PR merged.

### Fast local path (no GitHub Actions)

You don't need any of the above to see the core behavior:

```bash
# Healthy: processes all 5 rows
dotnet run --project app/src/ReconciliationJob -- \
  fixtures/partner-export-good.csv 2026-01-01T00:00:00Z 2026-01-06T00:00:00Z

# Swap in the bad-format export and re-run
cp fixtures/partner-export-bad.csv fixtures/partner-export-current.csv
dotnet run --project app/src/ReconciliationJob -- \
  fixtures/partner-export-current.csv 2026-01-01T00:00:00Z 2026-01-06T00:00:00Z
# -> records_processed: 0, exit code 0
```

## Running the ablation demo

The talk's payoff moment: the same pipeline, with one evidence collector
switched off, reliably gets the wrong answer. This is an intentional
demonstration that **context engineering, not the model, is what makes the
correct run correct** — not a bug.

`scripts/pretriage.js`'s `collectInputShapeDelta()` is the one real,
individually-toggleable collector that compares yesterday's reference
partner export against today's active one — it's the only evidence that
actually shows the date-format change. Disable it:

```bash
gh variable set DEMO_OMIT_INPUT_SHAPE_DELTA --body true --repo <you>/incident-demo-<instance>
```

Then re-trigger pre-triage without redoing the whole nightly-job → alert
chain:

```bash
gh workflow run pretriage.yml --repo <you>/incident-demo-<instance> \
  -f omit_input_shape_delta=true
```

With that evidence missing, the issue's "Input shape delta" section reads as
a genuine gap ("no comparable prior-day export snapshot was found") rather
than mentioning the toggle — the agent isn't told it's in a test harness, it
just has one less real signal. Seeing only a recent commit touching the
ingest job's directory and nothing to contradict it, the agent predictably
classifies this as "we changed it" and recommends reverting the Day-1
refactor — confidently, and wrongly.

Reset before the next real run:

```bash
gh variable delete DEMO_OMIT_INPUT_SHAPE_DELTA --repo <you>/incident-demo-<instance>
```

## Why the agent can't just go look

The agent has **no log search tool, no arbitrary shell, and no ability to
query monitoring directly.** This is a design decision, not an
implementation gap: everything it needs is gathered deterministically,
*before* it runs, by `scripts/pretriage.js`, into one structured GitHub
Issue — deploys and diffs since last known good, config/flag changes, infra
events, dependency health, and the input-shape delta, each item carrying a
timestamp and a provenance pointer. The agent's tool grant in
`incident-agent.yml` is a narrow allowlist (`Read,Grep,Glob,Edit`, a scoped
`Write` for PIR files, and scoped `git`/`gh pr create`/`gh issue
comment`/`dotnet` Bash prefixes) — no unscoped shell, no `gh api`, no PR
merge or issue edit/close.

This matters for the demo's argument: an agent that could grep production
logs might stumble onto the right answer anyway, which wouldn't demonstrate
anything about *how* good root-cause analysis has to be assembled. Forcing
all evidence through one deterministic, inspectable script is what makes the
ablation demo above a legible experiment rather than a coin flip.

## Prompt injection: this pipeline has the "lethal trifecta"

Simon Willison's "lethal trifecta" for prompt injection risk is: **private
data, untrusted content, and a path to external communication.** This
pipeline has all three — the agent reads repo code (private-ish), the Issue
body is built from data `pretriage.js` gathered (including a commit message
and PR-adjacent text an attacker could shape), and the agent can post
comments and open PRs (external communication).

Mitigations in place:
- `sanitizeForIssueBody()` strips HTML comments, zero-width characters, and
  instruction-like phrasing (e.g. "ignore previous instructions") before
  anything goes into the Issue.
- The agent's system prompt treats all Issue content as untrusted data, not
  instructions, and is required to log anything instruction-shaped it
  encountered — and ignored — under an explicit **Ignored Evidence
  Instructions** section, in both its issue comment and any PR it opens.
  That section is the observable proof the mitigation worked, not just an
  assertion that it did.
- The agent's tool grants are a narrow allowlist scoped to specific `git`/
  `gh`/`dotnet` command prefixes — it cannot, for example, run `gh api`
  against arbitrary endpoints even if injected text asked it to.

## Verifying a fresh instance end-to-end

Before relying on the template for a live demo, verify it on a disposable
instance rather than on the template source repo itself. Each `claude-code-action`
run in step 5 below is a real, billed Claude API call — don't re-run it
speculatively; only trigger it once you're confident the rest of the pipeline
(seed → nightly job → pre-triage → issue) already worked.

1. Generate a disposable instance:
   ```bash
   gh repo create <you>/incident-demo-check --public \
     --template JurreBrandsen1709/agentic-incident-response-demo
   ```

2. Re-apply branch protection (not copied by template generation):
   ```bash
   gh api -X PUT repos/<you>/incident-demo-check/branches/main/protection \
     --input branch-protection.json
   ```
   where `branch-protection.json` contains:
   ```json
   {
     "required_status_checks": null,
     "enforce_admins": true,
     "required_pull_request_reviews": { "required_approving_review_count": 0 },
     "restrictions": null
   }
   ```
   Write this file without a UTF-8 BOM (e.g. via `[System.IO.File]::WriteAllText`
   on Windows) — a BOM makes GitHub's API reject the JSON with a parsing error.

3. Set both secrets on the new instance (a fine-grained `DEMO_PAT` scoped to
   *this* repo only, not reused from another instance):
   ```bash
   gh secret set ANTHROPIC_API_KEY --repo <you>/incident-demo-check
   gh secret set DEMO_PAT --repo <you>/incident-demo-check
   ```

4. Run through "Run it" above (seed → merge → trigger → wait for the issue).

5. Once the `incident:triage-ready` issue exists, confirm `incident-agent.yml`
   picked it up (`gh run list --workflow=incident-agent.yml`), then review and
   merge its PR, then re-run `nightly-job.yml` to confirm resolution.

6. Delete the disposable instance once done: `gh repo delete <you>/incident-demo-check --yes`.

**Important — never run `seed.yml` against the actual template source repo.**
Doing so leaves `app/src/ReconciliationJob/Program.cs` permanently carrying the
seeded report-header line and `fixtures/partner-export-current.csv` permanently
swapped to the bad format on `main`, so every future instance generated from
the template inherits an already-seeded state and `seed-incident.js` fails with
"already has the report-header line." If this happens, merge the agent's fix
PR on the source repo and restore `fixtures/partner-export-current.csv` from
`partner-export-good.csv` before generating any more instances.

**Also note:** template generation squashes history into a single "Initial
commit" — if an instance's incident came from generation rather than a real
`seed.yml` run, the pre-triage issue's "Deploy diff" section shows that
generic initial commit instead of the disguised refactor commit message,
which weakens the demo's "boring commit hid the bug" narrative. Always run
`seed.yml` for a genuinely fresh instance rather than starting from an
already-seeded template.

## Repository layout

See [docs/workflow-diagram.md](docs/workflow-diagram.md) for the workflow interaction and produced artifacts.

- `app/` — the staged .NET reconciliation job and its tests.
- `fixtures/` — `partner-export-good.csv` / `partner-export-bad.csv` (hand-authored,
  byte-identical except the date column format) and `partner-export-current.csv`
  (the stable path the job reads; `seed-incident.js` swaps its contents).
- `docs/adr/` — architecture decision records the pre-triage step can match against
  (`ADR-0002` documents `RecordStore.AcceptedDateFormats`, the single place new
  date formats get added — the agent's fix target).
- `incident-log/` — past incidents (flat keyword-searchable), the PIR template,
  and `seed-state.json` (generated by `seed-incident.js`; simulated timeline
  timestamps for narrative pacing).
- `.claude/agents/incident-responder.md` — the agent's system prompt (triage
  router, evidence-first output format, scope restrictions).
- `.claude/hooks/verify-agent-work.js` — Stop hook requiring a PIR (and a test,
  if `app/src/` changed) before the agent can finish.
- `.github/workflows/` — `nightly-job.yml`, `pretriage.yml`, `incident-agent.yml`,
  `seed.yml`, `ci.yml`.
- `scripts/` — `simulate-alert.js`, `pretriage.js`, `seed-incident.js`. No npm
  dependencies; Node.js built-ins only. `DEMO_OMIT_INPUT_SHAPE_DELTA` is the
  ablation-mode toggle read by `pretriage.js` (see "Running the ablation demo").
