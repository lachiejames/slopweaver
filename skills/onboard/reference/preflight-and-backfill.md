# Preflighting each source, and pricing the backfill

The `connect --check` reports and how to branch on them, Gmail's per-scope breakdown, and what the window
choice actually means. The rules — a `missing` capability is a hard stop, and the corpus is a rolling window
rather than an archive — are in [SKILL.md](../SKILL.md).

## 6 — Preflight each source (the gate)

Run a `connect --check --json` per chosen source and branch on the JSON:

```bash
slopweaver connect github --check --json --repo <owner/repo>
slopweaver connect slack  --check --json
slopweaver connect linear --check --json
slopweaver connect notion --check --json
slopweaver connect gmail  --check --json
slopweaver connect outlook --check --json
```

For each report: `ok:true` → ready. A capability with `status:"missing"` is a **hard gap** — STOP and show
the user the exact capability + its `detail` (e.g. Slack `users:read.email`, Notion read-user-email, GitHub
`read:org`), and loop back to steps 4–5 to fix it. A `status:"warning"` (e.g. a bot token's reduced breadth,
or no GitHub SAML) is fine to **proceed on with the user's ok** — it just means reduced breadth. Only move on
once every chosen source is `ok`, or the user accepts its warnings.

Gmail's report is mostly a per-scope breakdown rather than one pass/fail, because a consented grant can be
perfectly valid and narrower than what was asked for. Every declined optional scope is a **warning** by
design — a read-only mailbox grant is a real choice. Say which verbs each declined scope costs, using the
report's own `detail`, and move on.

Outlook's report splits connecting into its two halves: `registration` (no `outlook-client-id` yet) and `auth`
(no consent yet) are each a hard gap naming its own fix. Its `scope:read`/`scope:manage`/`scope:send` rows are
warnings on the same rule as Gmail's, and `read-probe` is one live `GET /me` through a silent token refresh —
the row that catches a consent withdrawn at Microsoft, which `outlook connect --status` (the file alone)
cannot. Outlook has **no backfill**: it is read live, so step 7 does not apply to it.

## 7 — Choose the backfill depth

Ask the user how far back to pull. Offer: **90 days** (the default, ~3 months), **30**, **180**, or **all**
(everything — much slower, and much more on disk). Also accept an explicit `YYYY-MM-DD` start date.

**For Gmail, price `all` before you run it.** `slopweaver gmail measure` walks message ids only and reports
the exact count, the exact date of the oldest message and an estimated byte total with its sample size —
seconds of work, and the difference between "pull everything" as an informed choice and as a guess. Report
all three numbers to the user and let them choose.

Say what the choice means: the world model holds **the window they pick and nothing older**. Every later
refresh extends it forward from a watermark, so an answer can only cite work inside that window — the corpus
is a rolling window of recent activity, not an archive of the team's history. 90 days is the recommended
default because it is what a question about current work needs.
