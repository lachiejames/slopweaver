---
name: reflect
description: Run and read the self-improvement loop — mine the day's friction ledgers into ranked findings, five surfaced by default, say what the window could not show, record the owner's keep/adjust/drop grade on a finding, check whether the Friction Review is behind the newest daily report, and report the orchestration board's own hygiene. Report-only; it writes nothing but its own ledgers and a dated report. Use when asked what the self-improvement loop found today, whether it ran, why a finding keeps coming back, to grade or drop a finding, whether the friction review is stale, or what is rotting on the board. Phrases like "what did the self-improvement loop find", "run the reflect brief", "grade that finding", "drop that finding", "is the friction review stale", "did the daily mine run", "board hygiene".
argument-hint: "brief [--from 24h] [--write] | grade <finding-id> keep|adjust|drop | friction-review [--republish | --mark-published] | board | telemetry"
---

# Reflect — the self-improvement loop, report-only

**Pure code gathers and ranks; a visible session reasons; nothing acts.** The miner reads the local friction
ledgers, ranks what they say and surfaces five by default (`--cap`), and a session the owner can watch decides what the findings
mean. No model runs in the CLI (AGENTS.md rule 2), which is why this is a brief/answer pair and not a port of
the V1 reflect verb that called a model itself.

## The ceiling: T0, REPORT

The owner's ruling: the loop's first version writes **nothing** outside its own memory — no board doc, no
branch, no pull request, no message, no memory edit. The findings reach the owner as a section of a briefing
the owner already reads (`src/reflect/briefingSection.ts`, whose five-a-run cap the form enforces by
refusing, never by trimming). The next rung, T1 (create one unassigned board doc), is written in
`~/.slopweaver/self-improvement-loop-research.md` and is **not enabled without the owner's explicit word**. The
reason the ceiling exists: an unattended wrong change "silently redefines what the bot is",
and a gate that checks green rather than intent passed two freelanced fixes.

## The verbs

```bash
slopweaver reflect brief [--from 24h] [--to now] [--cap 5] [--json] [--write] [--dry-run]
slopweaver reflect grade <finding-id> keep|adjust|drop [--why <text>] [--closed-by <anchor>] [--json]
slopweaver reflect friction-review [--republish | --mark-published] [--home <dir>] [--json]
slopweaver reflect board [--now <iso>] [--json]
slopweaver reflect telemetry [--from 24h] [--to now] [--limit 500] [--json]
```

- **`brief`** — the miner. Prints one line per surfaced finding with its evidence beneath, then two sections
  that print **even when empty**: _could not verify_ (every collector's residue — an absent ledger, a line
  that did not decode) and the grade distribution per source, zeros included. It appends a sighting per
  candidate and one heartbeat row under `$SLOPWEAVER_HOME/ledgers/reflect/`; `--dry-run` appends neither, for
  developing against real substrates without moving the counters. `--write` writes
  `$SLOPWEAVER_HOME/morning/self-improvement-<UTC date>.md` atomically. **Every surfaced finding in that report,
  and on the Friction Review page republished from it, carries its finding id** (``- finding id: `<id>` `` beside
  the exact `reflect grade <id> keep|adjust|drop` line) **and its evidence** (one `- evidence:` bullet per line,
  folded behind a count on the page; a finding with none says `evidence: none recorded` in plain sight), so the owner can grade what the owner is reading without running `brief` for the id.
  How the owner grades is the owner's call; the report only makes the id and the evidence present.
- **A finding OPENS on what it measurably cost the owner or the fleet** (the owner's ruling):
  its heading is the collector's `consequence` (hours work sat on the owner's answer, runs dropped, a rewritten run's
  median beside an untouched one's — stated as a link, never a slowdown), then **ONE-OFF or SYSTEMIC with the
  count**, then _what happened_. **A candidate that cannot state a cost is never surfaced**: it is held in the
  backlog and counted under _could not verify_. The report carries a **How to grade** rubric (keep / adjust /
  drop and what each does); the miner's score is printed as _fleet ordering, not a grade_, folded on the page.
- **`grade`** — the owner's word on one finding, appended to the same `seen.jsonl`. **`drop` is terminal**: the
  miner never surfaces that finding again, however often it rediscovers it. Record the owner's grade the same tick
  the owner gives it; this is the only grade writer.
- **`friction-review`** — whether the Friction Review page is behind the newest dated report (`hasGap`)
  and whether anything is still writing reports at all (`isStale`). Exit `3` means one of those is true.
  `--republish` closes the gap: it renders the newest report as the `friction-review-<day><mon>` page
  through `publishPage`, then stamps it, and stamps nothing if the publish fails or the report is stale.
  `--mark-published` stamps alone, for a page a session published itself.
- **`board`** — the standing grooming leg: episodic docs stuck live, docs with no probe, malformed
  `doneWhen:`, dead `blockedBy`, untouched `ready` docs. Reads the board, writes nothing, retires nothing.
- **`telemetry`** — Claude Code's own OTLP export in Datadog: which tool calls actually failed. Read-only.

## The daily slot

The cadence is a **declared standing row**, not a cron and not a standing session:

- `self-improvement` in `src/live/automation/standingRows.ts` — `verb-run` of `reflect brief --write`, cadence
  `30 6 * * *`, `onMissed: skip`. It was revived after it silently left the store for
  seventeen days while its gauge read `current`.
- It runs because a supervisor pass read it due in `slopweaver automation due` and ran it, like every other
  automation ([automation](../automation/SKILL.md)). An absent row prints above every other line
  there, and `slopweaver automation register-standing` writes it back.
- **`verb-run`, not a seated session**: the miner renders its report on its own, so spending a visible
  session every morning buys nothing. The reasoning half happens where the report is read.
- **`skip`, not backfill**: the miner windows off `now`, so a missed slot has nothing of its own to mine.
  `verb-run` is `perSlot: false` either way, so a late pass runs once and covers every missed slot.

**A degraded pass is not a failed one.** A window with an absent or poisoned ledger exits `0` and says so
under _could not verify_, so its firing retires and the row is never re-claimed forever — a class once
measured. A genuine fault (a ledger append or the report write failed) exits `1`, which HOLDS the row on one
p0 finding until its fix lands ([the failure hold](../automation/reference/holds.md#a-failure-hold--placed-by-the-store-lifted-by-the-fix)).

## Recurrence: one counter, carried across days

The owner's ruling: ONE persisted per-finding counter, no second cadence. `daysSeen`
(`src/reflect/seen.ts`) counts **distinct UTC days** a finding was mined at all, surfaced or backlogged, so
a defect found on four days reads as one finding seen four days — the thing a single day's pass could not see.
A second brief on the same UTC day reads the stored count rather than adding a day
(`prepareCandidates`, `src/reflect/rank.ts`). The row's `06:30` is LOCAL time, so on an AEST install it writes
the previous UTC day, and a brief after 10:00 local counts one more. Only `surfaced` rows move
`priorSurfacings`. Never add a weekly companion pass to find cross-day patterns; read `daysSeen`.

## Who does what with the report

The recipe writes the dated report and never publishes it. The supervisor's sweep does, at step 11 of
[the sweep contract](../supervisor/reference/sweep-contract.md): `reflect friction-review --json`, and on
`hasGap: true` it runs `reflect friction-review --republish`. **On `isStale: true` it does not** — the
producer stopped, and the fix is the standing row, not a republish.

In a session asked "what did it find":

1. Read the newest `$SLOPWEAVER_HOME/morning/self-improvement-*.md`, or run `reflect brief --dry-run` for a
   window the row did not cover. Never run a writing `brief` twice in one day to "refresh" it.
2. For each finding, check it is still live and whether a board row already covers it before proposing
   anything — V1 measured already-done at 41% of all walk friction.
3. Say what _could not verify_ lists. Silence is not evidence the day was clean.
4. Record any grade the owner gives with `reflect grade`, in the same turn.

## What would mean this is not built

- `automation due` shows `self-improvement` late for days, or absent, and no pass is running it.
- `friction-review` reads `isStale: true` — no dated report for more than a day.
- A finding the owner dropped surfaces again.
- The same defect appears as several findings on several days instead of one finding with `daysSeen` > 1.
- Anything this loop writes lands outside `ledgers/reflect/` and `morning/` without the owner's word raising the
  ceiling. The one page `friction-review --republish` writes under `pages/` is the sweep's own republish,
  run by the supervisor, never by the recipe.
