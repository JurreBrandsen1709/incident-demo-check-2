# From Anomaly to Verified Fix

_Deterministic evidence assembly, agentic investigation, human-controlled change_

```mermaid
flowchart LR
    detect["<b>1. DETECT</b><br/><br/>Reconciliation job<br/><br/><i>records_processed</i>"]
    pretriage["<b>2. PRE-TRIAGE</b><br/><br/>Deterministic Node.js script<br/><br/><i>scripts/pretriage.js</i>"]
    agent["<b>3. INVESTIGATE</b><br/><br/>Claude Code Action<br/><br/><i>anthropics/claude-code-action@v1</i>"]
    verify["<b>4. VERIFY</b><br/><br/>Human merges PR<br/><br/>Re-run job: healthy"]

    detect -->|Anomaly alert| pretriage
    pretriage -->|Curated issue<br/><i>incident:triage-ready</i>| agent
    agent -->|Issue comment + PR: fix + test + PIR| verify

    classDef stage fill:#16324f,stroke:#8ecae6,color:#fff
    class detect,pretriage,agent,verify stage
```

### Design Properties

| **DETERMINISTIC** | **AGENTIC** | **HUMAN CONTROL** |
| --- | --- | --- |
| Deploy diff, config/flag changes, infra events, dependency health, input-shape delta, past incidents, ADRs, and sanitization — every item timestamped with a provenance pointer | Triage classification (we changed it / upstream changed / infra failed / unknown), root-cause investigation, tests, smallest fix, and PIR | Reviews and merges the PR; rerun proves recovery |

> The agent never receives raw alerts or production access. It receives a curated, sanitized evidence package — and no log search, shell, or monitoring tools of its own — and must prove the fix through tests and a pull request.