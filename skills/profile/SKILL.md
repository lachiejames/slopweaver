---
name: profile
description: Read and curate what the world model knows about its owner and about the people the owner works with — the global owner row, the per-person judgement column on the identity register, the measured length register, and the always-loaded context a session start injects. Also the owner's own words — what the owner spoke on a call or to the console, typed to the console, or typed to a chair while it held the supervisor pin, timestamped, spoken or written, searchable by phrase. Use when a session needs to know what the owner actually said or when, how to write to someone, when something learned about a colleague should be recorded, when the measured voice numbers are wanted, or when a session appears not to have loaded the owner's context at all. Phrases like "what did the owner say about X", "find the owner's words behind this card", "what do we know about the owner", "how should I write to Chris", "record that about her", "what is the measured length register", "why did this session not load the owner's profile".
argument-hint: "show | set --file <owner.json> | person (--id <uuid> | --name <n>) [--file <j.json>] | voice [--file <c.json>] | context | harvest --manifest <m.json> [--apply] | words [--phrase <w>] [--since 7d] [--how spoken|written] | words <anchor> | steers [unread | judge <anchor> --kind <k> --says corrects|stopped --quote <w>] | standing [add <id> --anchor <a> --covers <c> | withdraw <id> --reason <r>] | guidance [--json]"
---

The owner's ruling: three things moved into the local Supabase and
one thing became mechanical:

- **People are tracked on the identity register**, and a COLUMN on it carries facts and per-person
  judgement. _"One file per person doesn't make much sense."_
- **The measured voice register lands there too**, as one row per surface and cohort.
- **What is known about THE OWNER is GLOBAL**, in a table dedicated to the owner — because the plugin loads into
  `acme-admin` and into this repository alike, while Claude's own project memories cannot span the two.
- **Loading is mechanically enforced.** A `SessionStart` and `PostCompact` hook injects it. No session has
  to remember to fetch anything.

Every verb but `profile words` and `profile guidance` refuses without `SLOPWEAVER_STORE_URL`. `docs/store/owner-registers-and-roles.md` § The owner's own tables carries the
schema and the measurements.

## The owner's own words

The owner's ruling: the owner's words are a data source, queried with one command. `profile words` reads the record FILES on this machine, never the store, so a turn is there the moment it
is written: every stretch the owner spoke on a console call, every steer the owner gave the console voice or typed on it,
and every turn the owner typed into each chair that held the supervisor pin, inside that chair's tenure. A turn
the owner typed into
any other session is not read. A chair recovered by `supervisor chain --rescan` is dated from its session's first
record, so its tenure also holds what the owner typed there before it took the chair; a window the chain does not reach
back to is named as not read. With the live pin record absent or unreadable, the journal's last chair is not read
past its last link, and that is named too. A subagent's own prompts are never the owner's, and neither is a
chair turn with no `promptSource` saying the owner typed or queued it: it is named as not read, and its anchor is refused.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile words --phrase "jumpcloud atlas" --since 1d   # newest first
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile words talk:<turn>                             # one whole
```

Each line carries the minute, **spoken** or **written**, where, its length, any cut, and the anchor that reads it
whole; `--full` prints every turn whole, `--json` one document. Two caveats are the reading rule, not footnotes:
spoken or written is how the conversation CARRIED it, so a turn the owner dictated into the supervisor reads written;
and a spoken steer can list twice, as the call stretch and as the relay that reached a row. Every record that
would not read is named under the list — a call the call index names whose file is gone or holds no line, and a steer
the relay ledger receipted inside the window whose file is gone, and a turn whose anchor the one-anchor read would
refuse, included — every listed anchor reads again; one residue is stated, not closed: a steer whose receipt a crash cut off (the turn file is
written first, on purpose) and whose file is later lost leaves nothing to name it — and exit 1 (nothing matched, something unread) is not exit 3 (nothing
matched, nothing unread). The pure core is `src/profile/`. Every call file is read, whatever its
mtime, so a restored one is never missed. MEASURED: two runs of the 7-day default over 2,964 turns:
10.2–11.7s wall against 2.2s for a bare start (`/usr/bin/time -p slopweaver profile words --limit 1`).

### Which kind of correction a turn names: `profile steers`

The Alignment page's Slack chart counts what the owner has had to correct on Slack messages written as the owner,
one line per kind. **Whether a turn names a kind is a READ** (a turn that only
implies the pain is left out), so a session reads each offered turn and journals a verdict; nothing
is counted from a keyword. One turn is one point per kind it names, however often it repeats it.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile steers                     # one line per kind, days since the last
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile steers unread --since 60d  # cued turns nobody has read, each whole
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile steers judge <anchor> --kind em-dashes --says corrects --quote "<verbatim words>"
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile steers judge <anchor> --nothing
```

`--says stopped` is THE OWNER'S word that a problem no longer happens, and is the only thing that marks a kind
stopped: a kind with no correction lately reads "nothing observed for N days", never solved.
The quote is the words about that kind, verbatim from the turn — the verb refuses a paraphrase. A wrong read is
taken back with `--kind <k> --withdraw`; every read is a `steer_measurement` row in the store, which refuses any
change or removal, and an old `judgement/steer-kinds.jsonl` is imported once and refused if it changes after. A turn is
offered for reading only when it holds a kind's cue beside a word placing it on Slack, and the reading prints that
limit with every answer. Judge the turns the owner spoke while the chart was being designed as `--nothing` unless they
correct a draft or say a problem stopped.

A row registered with no anchor is tied to the turn it came from with
`handover quote <slug> --anchor <anchor> --apply`, which writes the anchor and the quote in one write — so its
Queue card leads with the owner's words. `handover register` prints that hint when a session types it with no anchor; it
does not refuse the row, so until a session ties it the card still says no words are recorded behind it.

### The standing ask a card rests on: `profile standing`

A card no particular steer produced — a finding,
a bot reply, an act — quotes the STANDING ask it rests on and says no other particular steer is behind it.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile standing                   # every active ask and what it covers
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile standing add <id> --anchor <anchor> --covers findings
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile standing withdraw <id> --reason "<why>"
```

The words are READ off the anchor by the resolver `handover quote` uses, never typed: find the turn with `profile
words`. A coverage is `findings`, `bot-replies`, `registered-rows`, `unlinked-cards` or one exact `act:<kind>` (read
the kind off `autonomy list`); one active ask at most holds each, refused at write, and an act's own kind is matched
before where it came from. Cover only what the owner's words actually stand behind: `registered-rows` is every row a session
registered without an anchor, which a findings ask does not speak for. The asks live in the store
(`standing_ask*`): an old `judgement/standing-asks.jsonl` is imported once, then refused if it changes. With no
store selected, a read answers nothing only when no journal is there.

**Every ruling in force, ranked: `profile guidance [--json]`** — doctrine, class steers, then rulings, asks, memories and
profile, one cited line each, `empty` or `NOT READ` per source; the Alignment page's **Your guidance** fold draws it.

## Reading, which is what most sessions want

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile show                       # the global owner row
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile person --name "Chris Jarvis"  # one person's judgement
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile voice                      # the measured length register
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile context                    # exactly what a session start injects
```

`profile context` is the one to reach for when a session seems not to have the owner's context: it prints the block,
says whether it came from the store or the cache, and names the reason the live read failed. It never
guesses — a section that could not be read prints and says so rather than going missing. When nothing loaded
it leads with a `# STOP` warning and exits non-zero; either way it records the attempt against this session in
`profile/loads.jsonl`, so a reload clears the door's `PROFILE_NOT_LOADED` hold and the `profile-unloaded` card, and
refreshes the cache. It writes no delivery marker — the environment names the session, never which of its contexts
ran it — so the PreToolUse `profile-held` check holds the next guarded call once more, with the owner's profile in the
refusal, and the retry passes. A session held with no copy of the owner's profile anywhere may run this and nothing else
until it succeeds ([why](../../docs/store/owner-registers-and-roles.md#loading-is-mechanically-enforced)) — bar a
first boot, a machine the owner's profile was never written, cached or loaded on (a selected store is no trace), where no call
is held at all, the door's writes included: there it
prints a `# FIRST BOOT` block naming `yarn store:start` (which locks and selects the store), `store push` and onboarding, exits 0 (`--json`:
`firstBoot: true`), and records nothing.

**`nothing curated` is not `no preferences`.** The judgement column is null for almost everybody, because the
owner briefs only a handful of the people the member pull places. A null says nobody has written anything down.

## Curating

Curation is deliberate and file-driven — export, edit, write back. Every statement carries where it came
from and when it was observed, and the hash of its own text is what makes a re-import idempotent.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile person --name "Chris Jarvis" --json > /tmp/j.json
# edit the buckets in /tmp/j.json, then:
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" profile person --name "Chris Jarvis" --file /tmp/j.json
```

Four things decide whether a statement belongs here, and each is a judgement rather than a field to fill:

- **A bucket, or nowhere.** `facts`, `channelPreferences`, `register`, `yesTriggers`, `noTriggers`,
  `reviewerRoles`. Anything that fits none of them is not per-person judgement — it is history, and the
  corpus already holds it. An outstanding task pasted into `facts` becomes advice a composer acts on.
- **`observedAt` is when it was OBSERVED**, never when it was imported. A channel preference seen in May and
  a reviewer role seen yesterday are both current-looking prose, and the date is what separates them.
- **`source` is a place a reader can go.** A permalink, a corpus citation, a `file:` path.
- **It is bot-readable.** The row carries no private lane, so writing something here is a deliberate
  decision to let the Slack-facing bot use it. Raw private material stays out.

A write is pinned to the revision it was read at. `REVISION_CONFLICT` means somebody else curated the same
person while you were editing: re-read, redo the edit on what is there now, never retry the same write.

## The owner row, and what stays out of it

`profile set --file <owner.json>` takes `{ displayName, personId, selfDescription }`. `selfDescription` has
three buckets and the distinction between two of them is the whole cost model:

- **`alwaysLoaded`** is injected into EVERY session, in every project. Paid for on every session start, so
  the set that earns it is named rather than computed from a threshold. Keep it very small.
- **`waysOfWorking`** is injected too, prefixed so a reader can tell it from a fact.
- **`facts`** is read on request and never injected.

**`profile.json` does not move.** It is per-INSTALL configuration — sources, checkouts, card chrome, the
reaction emoji, the owner's Slack id. None of that describes a person.

## The measured length register

One row per `(surface, cohort)`. A cohort is necessary rather than tidy: every sampled Slack message the owner sent
measures median 14 / p90 54, while a 312-message calibration against one colleague measures median 7 / p90
18, and a single `slack` row would describe neither.

Every statistic is nullable, and an absent one prints as `—`. A reader must be able to tell "not measured"
from "measured at zero".

**A Slack refresh measures it** from the messages the owner typed; `profile voice measure [--dry-run]` does the same by
hand (exit 3 when there was nothing to measure, or no owner row yet). It writes `slack/all-sent` and
`slack-dm/aggregate` and rebuilds the context cache in one transaction, leaves out what an app posted under the
owner's name, counts an edit once, and never replaces a cohort with an empty one — `src/profile/voiceMeasure.ts` carries
every rule. `profile voice --file` still imports cohorts measured elsewhere.

The outbound doors consume it through the context cache, so the check runs with no database and no
round trip. It **warns and never refuses** — owner ruling: no hard blocks for voice — and a
surface no cohort measured reports `NOT CALIBRATED` rather than clean.

## The 90 history files

`profile harvest --manifest <m.json>` applies a hash-pinned disposition manifest over the owner's archived profile
unit. Dry by default; `--apply` ingests the harvested files' `self` bronze records.

[reference/harvest.md](reference/harvest.md) carries the manifest shape, the four disagreements it refuses on, and what "dropped"
does and does not mean.
