# The fleet's own state: the board, the runs, the passes and the ledgers

Part of [The local Supabase store](../store.md).

Pretty much everything is taken out of the user-level Slopweaver directory and put into Supabase, which is where
the data should sit and which also makes it more portable. Sixteen tables carry the record-shaped half of that —
`board_row`, `run` + `run_event`, `codex_pass`, `door_event`, `autonomy_event`, `grant_row`, the owner's own words as
`owner_turn` + `owner_turn_location`, the Claude fallback plans and reviews as `codex_fallback_request` +
`codex_fallback_receipt`, the authored working state as `authored_body` + `authored_file` (+ `authored_absent`), and the measurements
as `measurement_blob` + `measurement_location` (`src/store/schema/board.ts`, `runs.ts`, `ledgers.ts`,
`ownerTurn.ts`, `codexFallback.ts`, `authored.ts`, `measurement.ts`; the last pair has its own section below).

**The board and the run journals stay authoritative as files, and their tables are a PROJECTION**, refreshed
by `slopweaver store import-fleet`. Nothing here replaces `handover register` — a board row survives session
death precisely because it is a file, which is the property AGENTS.md's "resume before anything else" section
depends on. What the tables buy is that "every p1 ask the owner made that is still open" is an index seek instead of
a parse of 2,099 YAML headers.

**The ledgers are the other way round: the row IS the record.** The door writes and reads `door_event` only
through `src/admit/doorLedgerPort.ts`, and the autonomy ledger, the grant journal and the Claude fallback
documents do the same through their own ports. The door and autonomy files are imported ONCE: every line
validated, every row read back against the file, and an import marker (`door_register`, `autonomy_register`)
written last, only on a clean pass. Until the marker stands the port refuses with `DOOR_NOT_IMPORTED` /
`AUTONOMY_NOT_IMPORTED`; after it, the file is never read again. A store outage is a typed refusal, never a file
standing in for the store — so `throughDoor` performs nothing it could not record.

**`board_row` does not wait for the import.** `handover register`, `settle`, `pause`, `unpause` and
`lint --fix` each re-read the document they just wrote and upsert its row on slug
(`src/store/fleet/boardMirror.ts`), so `doc_hash` witnesses the file on disk rather than what the writer
composed. `handover rule` does not, because it writes the run journal and leaves the document untouched. Only
a document directly in the home's `handovers/` is mirrored — the directory the import reads — and a home with
no store selected mirrors nothing. Any other failure is LOUD and not fatal: the file is already written and
is the board, and the verb names `store import-fleet --only board` as the reconcile. That is the loud
failure the dual-write step wants; it becomes fatal at the authority
flip, which is `boardStoreIsAuthoritative()` returning true, sequenced behind the build reading its own
migrations. The witness is `src/__tests__/integration/boardMirror.test.ts`, opt-in against a throwaway
database.

**Re-runnability is a per-table decision rather than a global one**, because the sources differ in kind. A
board document is MUTABLE, so it is re-projected whole and upserted on its slug, with `doc_hash` showing a
reader that it moved. A ledger line is not, so it is written once, keyed on the SHA-256 of its own bytes
plus its zero-padded line number (`src/store/fleet/importKey.ts`) — the same per-LINE key
`knowledge import-lessons` uses, and for the same reason: a file that has grown since the last apply
produces the same keys for the lines already imported and new keys only for the ones appended after them.
Proven on this install — a second full pass over an unchanged `door.jsonl` wrote 1 row, the one
line the door had appended in between, against 198,099 no-ops.

A truncated `door.jsonl` can never empty `door_event`: before the marker, a line with no row, a row with no line
and a stored record that differs from its line each refuse the mark (`src/cli/commands/store/importDoorLeg.ts`),
and after it a rerun only verifies, refusing each divergence and writing nothing. The import fills the `record` of
a row that has none, and never overwrites a record already there.

A line a pre-switch seat appended AFTER the marker fails every verify, holding the nightly red until an operator
runs `store import-fleet --only door --adopt-unmatched-door-lines` once: it inserts exactly the lines with no row,
only when those are the whole divergence and the file is unchanged at its check, names each, and re-reads
everything; an adopted row takes the next `seq`. No lock spans check and inserts, so a write DURING adoption is
caught only by the final read-back, which reports adoption unconfirmed; rows already inserted stay, each a real
line. Nothing current writes `door.jsonl` and no live door write carries a line's key (`src/admit/doorStoreRows.ts`),
so that window needs a pre-cutover seat or two adopters at once; a rerun converges. MEASURED: two
lines appended nine minutes after the marker held the nightly (repro: `slopweaver store import-fleet --only door`).

**`door_event` carries a `provenance` column, and it exists because most of that ledger is not real.** The
unit-test suite wrote door records into the ambient `$SLOPWEAVER_HOME` on every lap until the sandbox guard
landed (`src/__tests__/setup-ambient-home.ts`), so importing the
file as-is would put "this install posted 11,224 Slack messages in one day" into a database people
trust.

**The separator is NOT the guard commit's instant.** A commit's date is when the guard became AVAILABLE, and a
worktree on an older commit keeps running the suite against the ambient home
until it rebases. One did for nearly four more hours. Seven minutes after the commit,
one second holds 37 door rows, 20 of them on a single fixture `duplicateKey`, and
eight later rows name channel `C1` — a two-character fixture id no real Slack channel has. Separating at the
commit's instant presents 209 such rows as real external actions.

So the separator is DERIVED from the ledger itself: the last row bearing a proven test marker.
Two independent markers agree on it, which is what makes it a measurement:

```bash
# the last row naming the C1 fixture channel
grep 'to C1 under this identity' ~/.slopweaver/ledgers/door.jsonl | grep -oE '"tsIso":"[^"]+"' | sort | tail -1
# the last row on the dominant fixture key, in the same burst
grep <dominant-duplicate-key> ~/.slopweaver/ledgers/door.jsonl | grep -oE '"tsIso":"[^"]+"' | sort | tail -1
```

The guard commit remains the EXPLANATION for why the writes stop there rather than somewhere arbitrary —
the last pre-guard worktree rebased — but it is the explanation, not the criterion, and conflating the two
is the defect. MEASURED over 198,100 imported rows: 190,926 `unattributable` against 7,174
`attributed`, and `verb:slack.post` 169,220 against 119. Across the whole file those 169,339 posts carry
only 437 distinct `duplicateKey` values, three of which account for 137,217 rows — a duplicate key is the
hash of the message, the target and the identity, so 54,325 posts of one identical message is a fixture
replayed.

The vocabulary is two words and neither is "fake". A row STRICTLY after the separator is `attributed`;
every row at it or before it is `unattributable`, because no field distinguishes a test write from a real
one in that era and inventing one would be the fabrication the separation exists to prevent. Strictly
after, because the separator instant is itself a test write. **Nothing is dropped** — a query answering
"what has this install actually done" filters on `attributed` and is never wrong, and a better classifier
later re-labels rows that are all still here.

Three smaller shapes worth knowing before reading the DDL. `run` stores the fold (`phase`, `branch`,
`writer_session`, `doc_hash`) AND every journal line as a `run_event`, because the fold is not stable — a
new `RunEvent` member changes what an August journal means — and `derived_at` says which of the two a reader
is looking at. `codex_pass` holds one row per pass with its `record.json` whole and its `artifact.md`
inline, and nothing else: `orchestration/` is 875,337 files and 16 GB, of which 692,581 are `.ts`, `.js` or
`.map` inside a `.scratch` sibling — copies of code already in git, the scratch tier that never lands. And
the grants table is `grant_row`, not `grant`, which is forced rather than chosen: `GRANT` is reserved, and
`storeTableGrantStatements` builds `grant select on <table> to …` as raw unquoted SQL over every declared
name, so a table called `grant` would break the apply loop AFTER the migration had already succeeded.

**The owner's verbatim turns are the one thing here read out of the scratch tier.** A loss audit found the
`owner-turn-*.txt` files under `supervisor-scratch/<handoff>/` and `handovers/archive/` in no backup, and
everything else under `supervisor-scratch/` stays unimported (`src/store/homeRegisters.ts`'s `owner turns`
register carries the carve-out). `owner_turn` holds each distinct body once, keyed on the sha-256 of its
EXACT bytes; `owner_turn_location` holds every path it was found at, with the file's mtime. A file that
will not survive the round trip — a NUL, bytes that are not UTF-8 — is refused by name, never cleaned. The
leg reads one file at a time and keeps only distinct bodies resident: MEASURED, 29,366 files
and 89,570,356 bytes under the two roots (`src/store/fleet/ownerTurn.ts`'s `foldOwnerTurns` carries the
repro). `supervisor owner-turn-record --file` writes one file the moment a seat writes it, and `supervisor
owner-turn-show --ref` reads one back from the store only, so an anchor still resolves after its file is
gone.

**The Claude fallback receipts are the one class a landing GATE reads back out of the store, and the store is
their only authority.** Rule 9's substitute plans and reviews (`codex plan-fallback`, `codex review-fallback`)
used to live only in `codex-fallback/<requestId>/`, in no backup: MEASURED, 2,406 directories and
6,728 files over 257,464 KB (`du -sk ~/.slopweaver/codex-fallback`). Each request and its receipt are stored as
the exact text the session wrote, with its sha-256, because a receipt binds its request by digest and a
re-serialised copy would stop binding. The packets are not stored, being the diff and prompt git and the request
already pin: `prepare` writes one into a private `mkdtemp` directory under the OS temp root.

`prepare` and `record` write the rows through a REQUIRED port (`src/codex/fallbackPort.ts`), `DO NOTHING` on the
key: a lost insert is a typed refusal, never retried, so no writer overwrites a row. The readers — the landing
floor, `codex status`, `codex supersede` and the review announcement — read the store alone, and a store that
cannot be opened is `FALLBACK_STORE_UNAVAILABLE`, never a file fallback: a gate that read the disk when the
store was down could miss a BROKEN review written only to the store. A checkout behind main reads a migrated
store as foreign (`connectStore`), and the remedy is to rebase it.

`store import-fleet --only codex-fallback` imports a legacy directory ONCE: MEASURED on this install, 2,404
requests and 1,891 receipts, 4,295 rows and 13 MB in 4.7 seconds, and a second run wrote 0. It reads every row
back and reports a directory whose text differs from its row as `FALLBACK_IMPORT_DIVERGED`, exiting non-zero
without overwriting; a receipt the store holds and the directory lacks was recorded later through the store and
is no divergence. After that import the directory may be removed. The witness is
`src/__tests__/integration/codexFallbackStore.test.ts`, opt-in against a throwaway database.

**The grant journal is `grant_row` alone.** `grant record`, `perform` and `refuse` write one row each through a
REQUIRED port (`src/grants/port.ts`), and `show` and `list` read the store alone, in `seq` order — the order the
journal was written, which `recorded_at` is not. One row is one change, and the store enforces it: a partial
unique index allows ONE `grant` row and ONE `performance` row per `grant_id`, so a second performance loses its
insert and is `GRANT_ALREADY_PERFORMED`, never retried; refusals are many, each keyed by its own nonce. A store
that cannot be opened is `GRANT_STORE_UNAVAILABLE`, never a file fallback. `store import-fleet --only grants`
imports a legacy `grants/journal.jsonl` once, `DO NOTHING` on any unique index, then reads every row back and
reports a line that differs from the row the store holds for it as `GRANT_IMPORT_DIVERGED`, exiting non-zero
without overwriting. A store already holding two grant or two performance rows for one id fails the migration
that adds those indexes, loudly and with nothing deleted. The witness is
`src/__tests__/integration/grantJournalStore.test.ts`, opt-in against a throwaway database.

**The autonomy ledger is `autonomy_event`'s authority rows.** `autonomy record`, `steer`, `steer-class` and every
verb that acts unasked write one row through a REQUIRED port (`src/autonomy/port.ts`), carrying the validated
record whole in `record`; every reader — the briefing, the press-ledger guard, `talk` check-ins and steered cards,
`fleet landed`, the supervisor's scratch copy — reads the store alone, in `seq` order. A partial unique index
allows ONE action per `action_id` among authority rows, so two sessions racing one id leave one act: the same act
reads back as already recorded, a different one is `ACTION_ID_CONFLICT`, never retried. A store that cannot be
opened is `AUTONOMY_STORE_UNAVAILABLE`, never a file fallback. Rows an earlier projection wrote carry a NULL
`record` and are read by nothing. `store import-fleet --only autonomy` imports a legacy `ledgers/autonomy.jsonl`
once, through the ledger's own decoder, under `imported:`-prefixed keys a projection row cannot collide with,
`DO NOTHING` on any unique index; it reads every row back, reports a line that differs from the act the store
holds as `AUTONOMY_IMPORT_DIVERGED` without overwriting, and only then writes the `autonomy_register` row that
marks the import done. Until that row exists, a register still standing in the home makes every read refuse
`AUTONOMY_NOT_IMPORTED` rather than present an empty ledger. `autonomy adopt` repairs the FILE before that import
and refuses after it. The witness is `src/__tests__/integration/autonomyLedgerStore.test.ts`, opt-in against a
throwaway database.

**The owner's directives and corrections are `owner_directive` and `owner_correction`, versioned.** `turn brief`,
the memory hook, `reflect brief` and `store export` all go through `src/judgement/ownerDirectivePort.ts`. A changed
ruling retires its active version and inserts a new one; a partial unique index holds ONE active version per id,
so a racing writer is `OWNER_DIRECTIVE_WRITE_CONFLICT`. A legacy `judgement/owner-directives.json` is imported once
under the `owner-judgement` marker; each version's `origin` (`legacy-file`, `memory`, `store-import`) never changes.
Every read counts the `legacy-file` rows against that marker INSIDE the transaction reading the active rows, so a
lost imported row is `OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT`, never a smaller authority. An unreadable store
refuses `turn brief`. Witness: `src/__tests__/integration/ownerJudgementStore.test.ts`, opt-in.

**The authored working state is the same pair for every small directory the fleet writes by hand** —
`briefs`, `artifacts`, `judgement`, `profile`, `registers`, `morning` and the rest — and `handover-evidence`, the
proof behind settled board rows, which the rows in the dump outlived until it joined this class.
`src/store/fleet/authoredDirectories.ts` classifies every top-level directory of the home as `authored`,
`scratch`, `credential` or `other-class` (a sibling row's, or rebuildable), one line of reason each, and the
`authored` leg of `store import-fleet` reads only the first. `authored_body` holds each distinct content once
as `bytea`, keyed on its sha-256; `authored_file` holds each (path, content) pair with the file's mtime, so a
file that changes gains a row and the old bytes stay readable. MEASURED: 6,777 files and 181,550,760 bytes under 50 directories (repro: `slopweaver store import-fleet --only authored --dry-run`), 4,075 files and 91,482,862 bytes of them `handover-evidence`. The other 49 directories' 90 MB is below the 257 MB an earlier audit put on them — that bucket's directory list was not recorded, and the gap is not
explained here. **A credential never reaches a row**: the dump leaves this machine for a bucket cleared for
corpus data, so a text body tripping a SECRET class of the hygiene scanner is refused by name and the leg exits
non-zero. A refused file stays on disk only, and the leg exits 1 until every credential is out of it — each
token shape has its own class (`slack-app-token`, `linear-api-key` among them), so stripping one shape's lines
does not let the file through. A body holding a NUL is binary and is scanned as raw bytes and as UTF-16, which catches a token in it as
plain ASCII; a git bundle's pack is inflated and scanned object by object (`src/store/fleet/gitBundle.ts`), and
one that will not inflate is refused. An image's own compressed data is the one thing left unread, and the leg
prints the binary count so that stays stated. Reading back: `store authored-list`, `store authored-show --ref <anchor|path>` (the store only, never
the disk), and `store authored-restore`, which after `store restore` on a fresh machine writes every stored
file the home is missing and hash-checks each one. A present file is never overwritten: each write is an
exclusive create, and a directory resolving outside the home through a link is refused. No individual reader
was rewired to a table: the restore is what brings each file back to the path its reader already opens.

**Claude Code's auto-memory rides the same class through a mirror** (`src/store/fleet/claudeMemoryMirror.ts`).
It lives at `~/.claude/projects/<project-dir>/memory/`, outside the home, so against the default home the
authored leg first copies each corpus into `claude-memory/<project-dir>/` and the walk carries it. A corpus
missing from `~/.claude` keeps its whole mirror, and a mirror directory that will not read leaves its corpus out
of the pass. Otherwise the mirror follows each corpus exactly, but never destroys bytes: every version it removes
or overwrites is first kept in `claude-memory/<project-dir>/attic/`, content-addressed and never pruned, because
no pass can tell a deliberate deletion from a fresh machine's corpus and no verb reads an older stored version.
`store authored-restore` writes the mirror back into `~/.claude/projects/<project-dir>/memory/`, exclusive
create only. Both halves run only for `~/.slopweaver` itself: a `--home` or `$SLOPWEAVER_HOME` pointing anywhere
else neither reads nor writes `~/.claude`.

**`handovers/`, `runs/` and seven named top-level boot files are in the class too** (`AUTHORED_HOME_FILES`:
`identity-exclusion.txt`, `plans.json`, `profile.json`, `responders.json`,
`sync-author-denylist.txt`, `trusted-askers.json`, `general-rulings.json`). A retired `identity.json` is not
one: the `identity-roster` row is its authority, and only that row's one-time import ever reads the file. `board_row` and `run_event` split a file into columns and `jsonb`, so neither
table keeps a doc's or a journal's bytes; only this class brings them back. **A deleted file stays deleted**:
the tables only ever add, so each import that walked the whole home, from the store its own
`secrets/store-url` selected, rewrites `authored_absent` with the stored paths it did not find, and
`authored-restore` writes none of them. MEASURED, before that table: a restore into an empty home
brought back 22 recipe definitions live had deleted, one of them a HubSpot resync. The whole recovery:
[new machine](new-machine.md). **A file deleted between the walk and its read is a deletion, not a refusal**
(`src/cli/commands/store/importAuthoredRead.ts`): the leg names it in a note, stores nothing for it, and counts it
absent on that same run. A file still there that will not read stays a refusal. A nightly once exited 1
on `talk/chair-wake.json.lock`, a lock held for milliseconds, before this.

**`live/` joins the same class entry by entry, because it is not one class.** The turn markers, dispatches,
reviews, the ask ledger and the tag queue sit beside 572 MB of browser session working files and the unredacted
Slack and Gmail attachments a read fetched. So a classification row names a PATH and the deepest row wins:
`live`, `live/slack` and `live/gmail` are `split` (no class of their own, every entry named, an unnamed one
printed by the leg and never read), and a file row carves `listener/queue.jsonl` out of the listener's scratch
process state. The provider copies (`slack/thread-files`, `slack/file-reads`, `gmail/attachments`) are never a
row: the provider serves them again, and they are private and unredacted. MEASURED: `live/` adds
2,892 files and 26,707,199 bytes, 0 refused, 0 unclassified, and the whole leg then reads 5,594 files and
116,776,539 bytes under 50 directories (repro: `slopweaver store import-fleet --only authored --dry-run`).
`store slack-asks [--stranded]` is the reader switched to the store: it folds the newest STORED ask ledger with
the listener's own fold and says which asks were answered and which stranded — 270 asks, 37 stranded, at that
measurement. It also prints the 69 ledger lines that fold cannot read (`dispatched` rows in an older shape); reading the
file on disk gives the same 69. Each import stores the ledger again whenever it has grown, about 0.75 MB a copy.

## The measurements

Anything important goes into the database, which is already backed up every day, and is queried from there, so
eventually the user-level slopweaver directory could be removed without losing any functionality. The measurements are the files a proof, a bake-off or a screenshot left behind and canon
cites as anchors — `bakeoff/`, `datadog-shots/`, `evidence/` and `proof/` under the home. None can be
re-taken: a screenshot is of a moment, a bake-off lap of a model that has moved on.

**Two tables, the owner-turn shape.** `measurement_blob` holds each distinct body once, keyed on the sha-256
of its EXACT bytes; `measurement_location` is a log of OBSERVATIONS, one row each time an import found a path
holding a body the store had not last recorded there, with the file's mtime and its class
(`src/store/schema/measurement.ts`). A re-run over an unchanged home writes zero, an edited file is a new row
beside the old one, and a file edited A → B → A gains a third row naming A — so "newest" is the latest
observation, never the latest mtime, which would hand back B there and for any file `cp -p` or an archiver
gave an older mtime. **Append-only on purpose**: canon cites these paths, so nothing here deletes or prunes a
row. A symbolic link under a root is never followed and is refused by name, so the leg's count accounts for
every file it was asked for.

**Placement is decided by the BYTES, never the extension** (`src/store/fleet/measurement.ts`). A body at or
under 8 MiB whose bytes round-trip exactly through UTF-8 and carry no NUL is `inline`, in the `body` column.
Everything else — every image, and two bake-off replies that end in `.json` but are not UTF-8 — is `storage`:
an object in the private Supabase Storage bucket `measurements`, keyed by its own sha-256, which keeps
media in the one database's own Storage. Postgres is transactional and Storage is not, so objects go FIRST and the rows
second, in one transaction: a crash between leaves an object no row names, which the next run re-uploads to
the same key, never a row naming an object that was not written (`src/store/fleet/measurementStore.ts`). A
read re-hashes what Storage returns and refuses bytes that do not match their key.

**The Storage API is read off the running local stack, and nothing about it is stored**. Each open runs two `docker inspect` calls (`storeObjectsSelection`, `src/store/objects/selection.ts`):
the gateway container's `8000/tcp` publication gives the URL, and the Storage container's `SERVICE_KEY`
setting gives the key. MEASURED: 0.04 s, against 4.26 s for `yarn store:status -o env`, which
prints the same key as `SERVICE_ROLE_KEY`. A gateway published on any address but loopback is refused, with
no hatch, because another machine could reach the API. `SERVICE_KEY` is the Supabase CLI's own undocumented
name, so a CLI upgrade that renames it is a loud `OBJECTS_SERVICE_KEY_MISSING`, never a guess; `yarn
store:status -o env`, the pinned CLI, is the manual check for the new name.

A home whose every body is inline never opens Storage at all, so the import does not need the stack's
Storage half until a body does.

**Reading them back is from the store only.** `store measurement-list` lists locations by class or prefix;
`store measurement-show --ref` takes any anchor spelling canon uses, a home-relative path or a body's hash,
prints an inline body exactly as stored and writes a Storage body to `--out`; `store measurement-restore
--into <dir>` writes the newest body of every selected path back with its mtime. Every write is an EXCLUSIVE
create that must resolve inside `--into` through any link (`src/store/fleet/authoredWrite.ts`, the one
`authored-restore` uses), so a file that appeared since the plan, or a second stored path a case-insensitive
volume folds onto the same name, is re-hashed and left alone rather than replaced. None reads the home. MEASURED against a throwaway database (repro: the commands in
`skills/store/reference/measurements.md`): 885 files became 410 bodies — 334 inline over 50,981,902 bytes, 76
in Storage over 28,839,980 — and 885 locations in 3.2 s; a second pass wrote 0; a restore into an empty
directory then `diff -r -x .DS_Store` against the four roots differed ONLY in the six empty directories
there, which a store of files has no row for.

**`datadog/` is not a measurement root, deliberately.** `datadog/hits.jsonl` is a cache of raw events that
`src/datadog/detective/hitsCache.ts` says must never become a store of Datadog, and `datadog/catalogue` is a
rebuilt census whose home is a table of its own. Both are declared unmirrored in `src/store/homeRegisters.ts`
with those reasons, and the catalogue's table is a follow-up row on the board.

What the corpus's `raw` envelope was carrying, measured per source: [its own page](what-raw-was-carrying.md).
