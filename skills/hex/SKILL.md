---
name: hex
description: Read the organisation's Hex workspace live — which notebook already asks a question, what SQL its cells run, the rows one cell last produced, and when it actually ran — and correlate that long view with Datadog's fifteen-day window. Hex is READ, never ingested. Use when an investigation needs a number out of the warehouse, when a question is about who was affected rather than what broke, or when the answer lies further back than Datadog retains. Phrases like "how many customers were affected", "who is affected beyond 15 days", "is there a Hex project for this", "what does that notebook actually query", "pull the numbers from the warehouse".
argument-hint: "projects --query <words> | project --project <id> --tables | cells --project <id> --sql-only | output --cell <id> [--date-column <c>] | runs --project <id> | connections | verify | raw --path /v1/..."
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" hex $ARGUMENTS` and report the result.

## The one rule this skill exists to hold

**Hex is READ. Nothing you read here is ever written anywhere.** The owner does not want all of Hex
ingested into the corpus, but access to it during investigation is hugely useful to the team. `hex output` prints rows to your session and
writes nothing under `$SLOPWEAVER_HOME`; the corpus never sees them; a report quotes what it needs and no
more. What makes reading safe at all is Hex's own masking and access control — which is exactly why the owner wants
warehouse questions reached this way rather than through a new grant on some other system.

**And this integration cannot write to Hex.** `src/hex/client.ts` admits no HTTP method but `GET`, so there
is no verb that runs a project, opens an agent thread or changes a cell. If a question needs a query nobody
has written, say so and name the project it belongs in.

## The ladder — counts and config before rows, always

```bash
slopweaver atlas hex read --kind project --query <words>   # the LOCAL atlas: free, no network, no credential
slopweaver hex projects --query "<words>"                  # the live workspace, narrowed by title/description/category
slopweaver hex project --project <id> --tables             # its config, and the warehouse tables its cells query
slopweaver hex cells --project <id> --sql-only             # the SQL each cell runs — READ THIS FIRST
slopweaver hex output --cell <id> --limit 20               # the rows that cell last produced
slopweaver hex runs --project <id>                         # when it last actually ran — how old those rows are
slopweaver hex connections                                 # which warehouse each connection points at
slopweaver hex raw --path /v1/context/topics               # a documented operation with no typed verb yet
```

Start at the atlas, not at the network: `atlas hex read` costs nothing and says whether a project even
exists for this subject. Every verb takes `--json`. `hex raw` prints Hex's body as TEXT, unparsed; its
`--json` is `{ bodyText, status }` with `bodyText` still a string you decode yourself.

## Four things that decide whether your answer is true

- **An output is the DRAFT session's latest PREVIEW, not a fresh query.** Hex marks the endpoint unstable
  and returns what the cell produced when the draft was last run. The response carries its `runId`, and
  `hex runs --project <id>` is how you date it. A number quoted without its age is the failure mode here —
  a failed overnight schedule is exactly how a dashboard comes to show last week.
- **Read the SQL before you quote the number.** The filter, the date window and the table a cell reads are
  what decide whether its number answers the question you were actually asked.
- **Hex truncates.** The result carries `rowLimit`, `truncated` and a `totalRows` that is `EXACT`,
  `LOWER_BOUND` or `UNKNOWN`. Say which; a truncated preview quoted as a total is a wrong answer that reads
  like a right one.
- **What you read is unredacted; what you post must not be.** Say when a quote carries identity so the
  composing session redacts it before anything reaches Slack.

## The correlation the owner asked for by name

Datadog keeps about **fifteen days**: it can be useful for debugging issues over that window, but it is not
great for a full breakdown of who is affected and who is not, because often you will want to look beyond
fifteen days for that.

```bash
slopweaver hex output --cell <id> --date-column created_at --limit 200
```

prints the split: how many rows Datadog could still corroborate event by event, how many **only Hex** still
holds, and how many carried no readable date. Use Datadog for the mechanism inside the window and Hex for
the population across the whole period; say in your answer which half each claim came from.

`slopweaver store detect` wires this automatically — a question whose keywords hit a Hex project, a queried
table name or a data connection gets a Hex detective beside its Datadog one, and neither gate touches the
network.

## Exit codes

| code | what it means                                        | what you do                                |
| ---- | ---------------------------------------------------- | ------------------------------------------ |
| `0`  | Hex answered                                         | report it, with its age and its bounds     |
| `2`  | a bad flag                                           | fix the invocation                         |
| `3`  | **no Hex API token in this install**                 | card the mint to the owner — see below     |
| `1`  | Hex refused, was unreachable, or answered unreadably | read the message; it says what to conclude |

A `403` is the token's role not opening one object, never an auth verdict for the workspace. A
`MALFORMED_RESPONSE` is a fault, never an empty result: every typed verb reads through a strict boundary
(`src/hex/schemas.ts`), so the message names each new, missing or renamed field. Declare it there; `slopweaver
atlas hex sync` reports the same move as spec drift.

## When there is no token

The mint is **the owner's hand, never a session's**: creating an API token is a write inside the workspace, and the
browser guard refuses one. Card it, with these exact steps:

1. app.hex.tech → Settings → API keys → create a personal API token.
2. `slopweaver secrets set hex-api-token` (no-echo prompt; never in argv).
3. `slopweaver hex verify`, then `slopweaver atlas hex sync` to fill the atlas's project and resource kinds.

Hex mints no read-only scope — a personal token carries the minting user's own role — so `hex verify` prints
that role rather than claiming the credential is read-only. What bounds it is the GET-only client.

## What this skill does NOT own

The SURFACE MAP. `slopweaver atlas hex sync | walk | report` and `/slopweaver:atlas hex` answer _what can be
asked of Hex_ and store no result set ever; these verbs answer _what this workspace holds right now_ and
store nothing at all. Reading the atlas first is cheaper and often enough.

## Running this from Codex

In Claude Code `${CLAUDE_PLUGIN_ROOT}` is substituted for you. In Codex it is not: resolve this `SKILL.md` on
disk, take the plugin root two directories above it, and invoke `<plugin-root>/bin/slopweaver` by absolute
path. Never run bare `slopweaver` on either host — an ambient `PATH` may point at another checkout.
