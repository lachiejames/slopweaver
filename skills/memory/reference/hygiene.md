# The memory-hygiene pass

`slopweaver memory hygiene` — the standing review of the auto-memory corpus and the knowledge rows, scheduled weekly, that proposes
keep/adjust/drop and never makes an edit. [SKILL.md](../SKILL.md) is the surface; this is the detail.

## Where it came from, and what answers the worry about overkill

The ask was a scheduled pass that keeps the memories pruned, deduplicated, consolidated and free of stale ones,
checking them against the current codebase and the transcripts and verifying adversarially, with the worry that
this would be overkill.

**The overkill worry is answered by the SHAPE, not by scope.** There is no write path to a memory file anywhere
in `src/memory/hygiene/`, which is a stronger guarantee than a flag defaulting to off, because there is no code
to enable. The pass appends to one ledger and writes one report; the corpus is read-only to it.

Two facts it does not re-derive, and neither is a judgement this pass is allowed to revisit:

- **The strictness bar** — identity, voice and hard rules stay; a technique becomes a skill; project state goes
  to the profile. The owner's ruling.
- **The sharpened test**, from the owner: a memory earns its place **only if its presence changes
  agent behaviour**. That line is printed as evidence on every enforcement proposal, because it is the test the
  reader is being asked to apply.

## The six checks, in the severity order the card ranks by

`HYGIENE_CHECK_IDS` in `src/memory/hygiene/types.ts` is declared in that order and ranking reads the array's
index — there is no score to argue with, and no per-check weight for anyone to retune.

| Check            | What it measures                                                             | What it can recommend   |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------- |
| `index-budget`   | `MEMORY.md` against the loader's first-200-lines-or-25KB limit               | `adjust`                |
| `schema`         | every `check` finding: routing, frontmatter, links, placement, addenda       | `adjust`                |
| `referent-gone`  | a path, flag, verb or skill a memory or knowledge row names that no tree has | `adjust`                |
| `referent-moved` | a referent that resolves somewhere other than where the memory says          | `adjust`                |
| `duplicate`      | rare-token Jaccard over slugs and descriptions, at **0.42**                  | `adjust` — never a drop |
| `enforcement`    | a memory whose vocabulary a gate, schema, skill or always-on doc already has | `drop`, unless refuted  |

## The stores it reads

The pass covers four memory stores: knowledge rows naming the ask burst-surface module and the recipe-scheduler skill had stood unflagged
after both were gone, while `knowledge recall` still handed them out.

| Store                                     | Who judges it                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| the slopweaver auto-memory directory      | every check here                                                                  |
| the knowledge rows in the memories table  | the referent arm — each claim's current lesson or preference, as recall returns   |
| in-repo canon: `AGENTS.md`, rules, skills | CI, per pull request: the stale-reference ratchet, `src/canon/staleReferences.ts` |
| the retired acme-admin auto-memory corpus | nobody: S4 retires it                                                             |

A knowledge row is named `knowledge:<id>` on the card, so `memory grade` answers it like a leaf. A trace is
never scanned — it records where one investigation looked at one instant. A `skill` referent is a
`skills/<name>` or `/slopweaver:<name>`, and it resolves only while that skill's `SKILL.md` stands.

**A row is read in its own house style, not a leaf's.** A leaf's referent is a code span; a row almost never
spans one (measured: 218 of 1515 recordings name a `src/<file>.ts` path, none in backticks), so its prose
is read too — a path counts only when its first segment is a top-level directory of a checkout, which keeps
`~/.slopweaver/…`, `$SLOPWEAVER_HOME/…` and subdirectory-relative names out. A verb is read only from the
row's `repro`, never from a sentence that happens to name the binary. A shorter path the same row also names
in full (`src/<file>.ts` beside `packages/<pkg>/src/<file>.ts`) is dropped as shorthand for it, and a path
through an installed package is dropped outright: that file is a dependency's, never the checkout's.

**What the prose criterion cannot tell apart**, printed on every card: a row naming a file in ANOTHER
repository whose root shares a name — a dependency's `src/`, a scratch file a repro `touch`es — is proposed as
gone, and so is a spanned flag belonging to another tool. The first live run over both checkouts raised 30 knowledge proposals, two of them this class; one
terminal `refused` retires each for good.

**Two checkouts, one verdict.** The slopweaver memory directory is loaded by acme-admin sessions too, and a row
does not say which repository it was recorded in, so the weekly row passes `--also-repo` with the acme-admin
checkout: a referent EITHER tree holds resolves. The two trees share `docs/`, `.claude/` and `scripts/` at
their roots, which is why no path prefix could have picked the tree instead.

**An unread memories table is exit `1`, after the report is written.** The auto-memory half is still true, so
it is judged and recorded, and the residue opens with why the rows were not read. A `0` or `3` would have the
scheduler stamp the week covered with the knowledge half never judged; a `1` is a failed slot with its detail
and a retry floor.

**A truncating index is the card's first red item and is NOT an exit code.** The build was asked to "refuse
quietly rather than warn", and what that rules out is a `logger.warn` nobody reads. The pass reads leaf files
off disk rather than through the loader, so a cut index costs a SESSION its memories and costs this run
nothing: reporting it as a deferral would tell the scheduler the verb did nothing on a run that wrote a full
report.

**`enforcement` is the ONLY check that can recommend a drop**, and it takes two refutation passes to get
there. Everything else proposes `adjust` at most, which is the design rather than a coincidence: a dead
referent means the memory's claim needs updating, not that the memory was worthless, and which of two
overlapping memories survives — or whether they become one — is a judgement about content that the pass has
no way to compute. It proposes `adjust` and names both.

**One `adjust` that means delete.** An `amends-canon-without-row` finding on a row that is `done` says the
memory's job is over, and still arrives as a `schema` `adjust` — the `drop` path runs only through
`enforcement` and its refute arm. Read that finding's own message, which says delete, over the recommendation.

## The thresholds are measurements, and each carries its own repro

- **0.42** is the Jaccard the manual pass ran at, which found exactly four real pairs on the
  corpus it was measured over. Raise it and real pairs disappear; lower it and every memory about one platform
  pairs with every other. It is deliberately not a flag: a threshold a caller can retune is one nobody
  measures again.
- **0.6** is the enforcement check's coverage SHARE — what fraction of a memory's own rare vocabulary an
  enforcer has to carry. An absolute count was tried first and was wrong on the live corpus: two shared tokens
  is a strong signal in a five-token memory and noise in a thirty-token one.
- The duplicate scan's document-frequency ceiling is `max(0.25, 2/count)`, because a flat quarter over a corpus
  of three rules out the token in exactly two memories that IS the duplicate signal.

```bash
slopweaver memory hygiene --dir "$HOME/.claude/projects/<project>/memory" --repo "$PWD" --json \
  | jq '[.proposals[] | select(.check == "duplicate")] | length'
```

## The adversarial arm

Every drop candidate is attacked before it is proposed, mirroring the register's own mining pass. Two families
of rescue live in `src/memory/hygiene/refute.ts`, and a rescued candidate arrives as a `keep` with the
refutation printed beside it rather than as a drop the owner has to overrule:

- **The bar exemptions**, from the strictness bar — a `user` memory is identity; a live
  `ownerDirective` is control-plane state whose revocation path is an explicit `ownerDirective: false`, never a
  tool's deletion; a memory correcting one named corpus record is still needed while that record is readable;
  and a memory other memories wikilink to cannot be dropped without minting dangling links.
- **An irreducible why** — a ruling date, a verbatim quotation, or a `**Why:**` line. An enforcer carries the
  rule; only the memory carries when the owner decided it and in what words.

So a `keep` on the card is not the pass padding its output: it is the pass reporting that it found something
and then talked itself out of it, which is the half of the work the owner would otherwise have to redo by hand.

## The ledger, and what recurrence means

Every proposal and every answer is one JSONL row under `$SLOPWEAVER_HOME/ledgers/memory/hygiene.jsonl`. It is
the pass's only write outside the report, and it is what makes two things possible:

- **`days seen`** — distinct calendar days a proposal has been raised on. It breaks ties inside one check, and
  never across checks: a duplicate pair ignored for a week outranks one found this morning, and never outranks
  a truncating index.
- **A terminal refusal.** `memory grade <id> refused --why '<why it stands>'` and the pass never raises that
  proposal again. `accepted` is recorded rather than acted on — this pass still never edits a memory, so an
  accepted drop is work for a session, not for the scheduler.

`--why` is required on both answers. An answer with no reason is a vote the next run cannot act on, and on a
refusal it is the only surviving record of why the memory stands.

## The schedule

`memory-hygiene-weekly` is a `verb-run` row under `$SLOPWEAVER_HOME/live/recipe/definitions/`, Monday mornings,
`onMissed: skip`. Skip rather than backfill because the pass judges the corpus and the tree as they are NOW: a
missed week replayed would produce the same card twice, since the work is not scoped to its slot.

The destination is `local-atlas` — the run's evidence is a file in the morning report directory, which is where
the owner already reads. It posts nothing itself, and there is no board: the owner does not visit boards.
