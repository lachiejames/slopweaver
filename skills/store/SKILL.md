---
name: store
description: Answer a question from the organisation's own GitHub/Slack/Linear/Notion history, or hand back the raw cited records behind it. Use when the user asks what the team decided, why a choice was made, who owns something, or what happened on a piece of work and the answer should come from their history rather than from you — and use it when they want the sources without prose. Phrases like "what did we decide about", "why did we", "who owns", "what happened with", "ask the corpus", "show me the records", "just the sources", "no summary".
argument-hint: <question>
---

**You are the model here.** No `store` verb runs one — rule 2 forbids any Slopweaver process from starting
one — so a read is a hand-off and you perform the middle step.

Two verbs answer a question, and the difference is whether anything READS the records:

- **`store read`** — the fan-out. It selects candidates, shards them, and you dispatch a reader per shard.
  Reach for it when the answer needs judgement over the evidence.
- **`store cite`** — retrieve-only. It prints the record slice (source, cite token, url, title, snippet) and
  composes nothing. Reach for it when the user wants the sources, is checking what the store actually holds,
  or is feeding another agent.

## One mechanism under both

Postgres full-text plus structured filters select candidates out of the local Supabase store. **Nothing
ranks.** RAG is dead: no pgvector, embeddings, re-ranking, semantic search
or locally-built lexical index. There is no index to build, no encoder to download and no
second path to choose between. Rows come back newest first, so never read the order as relevance.

## `store read` — step by step

1. `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store read "<question>" [--search <terms>|--contains <literal>|--like <pattern>] [--person <name>] [--source <s>] [--since <iso>] [--limit <n>] [--shard-chars <n>]`.
   It selects candidates, writes one shard file per reader, and prints the exact instruction for each. It
   runs no model. The selection flags are the same for both verbs —
   [selection](reference/selection.md) is the whole vocabulary and when each one is the right question.

2. **Dispatch one `Agent` per shard, ALL IN PARALLEL, each with `model: "haiku"`**, giving each the
   instruction printed under its own shard, **verbatim**. That is where the model runs, in this visible
   session, which is what rule 2 requires. The instruction carries a token identifying that shard, and it is
   the only thing routing a reply back — hand each reader ITS OWN block and never edit the token or
   substitute the readable `s1`, or the reply is refused as an unknown shard.

3. Collect every reply into one JSON array and run
   `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store collect --plan <the plan path it printed> --replies <file>`.
   It refuses an id from another shard, a quote that is not verbatim in its record, and a shard file that has
   changed since the plan was written — each by name — and **exits non-zero if anything was refused or any
   shard went unanswered**. Read the refusals; do not compose over a harvest you have not read.

4. **Compose the answer yourself** from the surviving findings, citing the ids `collect` printed. Those ids
   are the citation tokens, so nothing maps between what a reader said and what your answer cites.

An empty harvest is a real answer and means "nothing in the LOADED window", never "nothing was ever said".
Say which, and say the window.

## `store cite` — the records, not an answer

`"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store cite "<question>" [same selection flags] [--limit <n>] [--json]`.
Show the records exactly as returned. This is evidence retrieval: **do not fill a gap from memory and do not
invoke another model over it.** `--json` is the shape to hand a subagent.

## Follow the thread — one query is rarely the investigation

Nothing ranks because **following a conversation reaches evidence ranking cannot**. A first query that comes back thin or obvious is a lead, not an answer: run another with
different terms, read the messages AROUND a hit rather than the hit alone (`slopweaver store detail` opens
one record in full), and pull on names, channels and ticket ids the first pass surfaced. Investigate the way
the owner would.

Two honest limits, so you do not overclaim. `collect` validates a finding against the shard its reader was
given, so evidence discovered outside that plan is not admitted to it — start a new `store read` for a new
lead. And a shard clips an individual record past its budget, so a very long record reaches its reader
truncated.

## What the store holds

Freshness is whatever the last `slopweaver store load` or `refresh --store` put in. `slopweaver store
status` reports it, and reports **bronze drift** beside it: how many native ids this home's bronze offers
that the store does not hold, per source, with the repair command on any non-zero line. The scan runs
without being asked (measured, 4.88s over all eight sources against 2.36s without it — repro:
`time slopweaver store status`) because the gap it reports is otherwise invisible; `--check` makes it exit 1
on a missing row or on a scan it could not complete. **Without `--check` nothing about bronze changes the
exit code**, not even an unreadable file: that prints `bronze drift: NOT MEASURED` and the verb still exits
0, because a caller who asked what the store holds got an answer. `--json` carries the same failure as a
`driftFailure` string beside an empty `drift` array.

**A source whose bronze reaches a `no-access` path on the owner's protect list is not read.** It prints
`NOT SCANNED` with the entry and its reason, no count and no repair line, sits under `--json`'s `withheld`, and
does not fail `--check`. `store ingest` refuses it before opening the store. A protect list that cannot be
read scans nothing. Never take a path off the protect list to clear the line
([why](../../docs/store/bronze-and-source-coverage.md)).

**A zero is a claim about the WINDOW files, not the corpus.** The scan omits the canonical `compact.jsonl`
by default and says so on every line, including a clean one; `--full` reads it and costs accordingly. If
the store is empty or unreachable it says so; `/slopweaver:onboard` is the cold start.

## The measurements — a proof, evidence or screenshot an anchor cites

An anchor under `~/.slopweaver/bakeoff/`, `datadog-shots/`, `evidence/` or `proof/` is read FROM THE STORE,
never the disk copy, so it still resolves after its file is gone: `store measurement-show --ref <anchor>`
prints a text body, and writes an image or other binary body byte-exact with `--out <file>`.
`store measurement-list` and `store measurement-restore --into <dir>` are the rest;
[measurements](reference/measurements.md) is the whole shape, the two Storage secrets and the proof.

## Published pages into the store — `store pages-import`

`store pages-import` carries `pages/` and `published-pages/` into the five published-page tables, every body an
object in the private `published-pages` bucket. It reads both folders, changes neither, and refuses the whole run
on any link, odd entry, unsafe name or bad freeze, naming each. Re-runnable: a second run writes only what changed.
`--dry-run` counts without a connection. The move's stages: [published pages](../../docs/store/published-pages.md).

## The local stack is locked — `store start`, `store lock`

`yarn store:start` runs `store start`: the pinned CLI starts the stack, then `store lock` leaves the verbs'
own login (`slopweaver_login`, a random password in `secrets/store-url`) as the only one this Mac's logins
can use. It ends earlier sessions, revokes the API roles' table rights, and proves each step by behaviour.
Before the role is first created, it keeps a verified local copy of the store. It refuses, changing nothing,
when the database port is published beyond loopback (`PORT_EXPOSED`: set Docker Desktop's Port binding
behavior to "Localhost only"). `store verify` fails on any
lock finding. Order, reruns, `--rotate` and what it does not stop are in [the local lock](reference/local-lock.md).

## Where the backup goes — `store backup --set-destination`, `--add-destination`

A night is staged once and written to a LIST of local destinations in order, typically this Mac's folder for
rollback and a pinned SSD for DR. `--set-destination <address>` replaces the list with one, `--add-destination`
appends one and `--remove-destination` drops one; each pins an external drive (`/Volumes/<name>/…`) by volume
UUID. Each destination gets its own receipt and its own `--status` block, so with the SSD out tonight still
writes this Mac and the SSD reads `DRIVE NOT PLUGGED IN` beside its `last written <date>`. `--sweep-only` sends
it what it missed once it is back, and `store backup-register`'s hourly `store-backup-sweep-hourly` row runs that
sweep at half past every hour. Remote kinds are refused as not built: [the backup](../../docs/store/backup.md).
The owner's protected paths bind every mode. A `no-access` source is never read and is printed `NOT backed up`.
A protected destination fails `HELD`, there and in `--status`. A protected staging root or an unreadable registry
holds the run, so `--status` reads it red, never green.

## The backup restores — `store rehearse`

`store rehearse` restores the newest DR backup into a throwaway Postgres of its own and compares it with the
live store, opened read-only. It refuses the live database name, port or container by construction, exits 2
on that refusal, and runs monthly as a standing row that cards only on a failed rehearsal. It opens the backup
with the master password in `secrets/`, never the Keychain, so it proves a wiped Mac's path. Commands, flags
and what it leaves on disk: [the restore runbook](../../docs/store/restore-runbook.md).

## A wiped or new Mac comes back — `store recover`

`store recover --destination <dir>` is the one command after `yarn store:start`. It asks once for the master
password, unwraps the backup key from the wrap beside the backup (never the Keychain), and brings back the store
and its Vault secrets, the files, the credentials, `store-url`, the password itself, the board, the journals and
the boot files into one home, applies this checkout's
migrations, and never overwrites a differing file: what differs stays in staging and is named. The one
exception is the home's own `store-url`, repointed at the recovered database when that is its only change and the
database it named holds no store; one holding a store is refused before anything downloads. A re-run
resumes from its marker. `--dry-run` names the backup and writes nothing. Order, refusals and what no backup
carries: [a new machine](../../docs/store/new-machine.md).

## The owned state, exported, planned, staged and applied — `store export`, `store import`

`store export --out <dir>` writes what no provider can hand back — the knowledge register and its recalls,
the owner profile and voice register, the directives, standing asks and steer verdicts — into a NEW private
directory with a manifest of every part's rows, bytes and sha256. `store import --from <dir>` CHECKS one, then
PLANS it against the live store: rows new, identical or conflicting, and a question for every new instruction
and every conflict. It plans by default and writes nothing; `--approve <plan digest>` only STAGES it in the
store, nothing live. `store import-questions` lists the open questions and `store import-resolve` records one
answer, never changed: triggers seal a batch once staged, remove one only whole and never once answered, and refuse any update or truncate. `store import --apply <batch-id>` then writes what the answers admit in ONE
transaction, or none of the batch (each register's legacy home file is imported first, in its own): a restored instruction left inactive lands inactive, and an append-only row that
differs keeps the current row and is reported (`--stop-on-conflict` refuses instead). `--unmanifested` reads an
export made before manifests, a part it lacks reported unavailable: [import and export](reference/import-export.md).

Question: $ARGUMENTS

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
