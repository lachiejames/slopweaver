# Owner-ruled additions: the silent-check family

Part of [The recurring-failure register](../recurring-failure-register.md). These classes came out of the
session memory corpus, which is sent to the page each lesson governs rather than to boot-time memory.

**The family's one property: an instrument returns the signal success returns, and it never looked.** Every
member produces a green, an empty set or a plausible number, so nothing prompts a second look, and the failure
lives in the instrument, which is the thing nobody re-tests. No check leaves a known gap; a silent one closes
the gap on paper and stops anyone looking. That makes a silent check strictly worse than none.

Kin filed elsewhere on the register, each one seam of the same property: a filtered wait that matched nothing
(`waiter-reads-empty-as-cleared`), an invocation whose exit code is the filter's
(`verification-run-in-a-shape-whose-green-means-nothing`), a negative claimed from one look
(`unverified-absence-impossibility-or-blocker`), a failure caught into an empty default
(`errors-swallowed-into-empty-defaults`, gated by `no-silent-fallback`) and a verdict about a tree nobody named
(`verdict-computed-against-the-wrong-tree`). The test-side rule is `.claude/rules/testing.md`'s: assert on a
falsifiable witness, never on silence.

## The head of the family

- **`check-cannot-tell-passed-from-did-not-run`** — a check whose "passed" and "did not run" print the same
  thing. Measured instances, each found by accident and each first read as clean:
  - **A probe that threw.** A selector guard carried over from the previous page made a render probe
    call `getComputedStyle(null)` on its first line. Output: nothing, identical to a clean page.
  - **A fold the probe could not enter.** A collapsed `<details>` is `display: none`, so an overflow probe passes
    every width and the page breaks the first time the owner expands it.
  - **A no-op override.** `min-width: 0` against `flex-shrink: 0` changed nothing, three runs running, with
    byte-identical numbers — exactly what a fix that does not work prints.
  - **A probe that could not measure and said so quietly.** Registered independently in a different
    subsystem: the post-merge docs-budget probe hit a git ref-lock race and printed `could not measure main`,
    which reads as clean at a glance. The `not-evaluated` branch of `postMergeDocsBudgetOutcome`
    (`src/cli/commands/github/mergeAdminCore.ts`) still prints one line and raises no alert; the board row
    `the-post-merge-docs-budget-probe-reports-could` owns the fix. This instance is what makes the class a
    property of how checks get written here rather than one seat's blind spot.
  - **A re-run that tested the output, not the inference.** A peer read `ls -A` on the credential
    store as proof a seat had lost its pin; a second session re-ran the command, got identical bytes and took
    the agreement as confirmation. The bytes were never in doubt, canon already said the directory is empty by
    design, and the second session stood itself down as a publisher on the strength of it.
  - **A prose claim with no settling command.** A row arguing this very class asserted a sibling row's gap was
    "still open"; one command showed the sibling retired as a duplicate on an anchored ruling.

  **The technique — make the witness falsifiable, then prove it fires:**
  - Report through a marker whose absence is unambiguous (`<div id="PROBE_RESULT">`), never through a value
    that already looks right, and wrap the probe body in `try/catch` so a throw reports itself.
  - Force a failure and watch the check report it before trusting a pass, in both directions.
  - Make "could not measure" its own RED outcome with the reason, never an absence.
  - For a diagnostic override, read back the computed property it sets, not only the outcome.
  - When checking a peer's claim, re-derive the CONCLUSION; re-running their command only re-tests the bytes.
  - Every claim on a page or row names the command that settles it.
  - Carry no selector, guard or assumption from the last thing measured.

## The members

- **`check-answers-a-narrower-question-than-its-claim`** — the instrument is sound and answers a narrower
  question than the sentence written about it, and its output never says so. Measured:
  - `grep -rl … | head -3` returned three hits and was reported as "no source file exists"; the file was there.
  - `git log` in a worktree answered "what is my branch head" and was written up as "cannot verify from here";
    the remote-tracking ref held the commit throughout.
  - `git cat-file -t` proved a commit EXISTS and was read as proving a base sane. Existence, reachability and
    ancestry are three questions; a base needs the third.
  - `scrollWidth == clientWidth` proves a page never scrolls sideways, which a squeezed table also satisfies.
  - A presence-only gate ("does the page name a reproduction command") passed a page whose command
    reproduced estate counts and touched none of the claim that went false.
  - A wait loop grepped `slopweaver github read <pr-url>` for the word `MERGED`, fired on a page reading
    `"state": "OPEN", "merged": false`, and the seat reported a landing and closed the row as shipped.
    `git ls-remote origin main` and the door's `merged` field settled it. Same shape: `git grep -l` for a
    module was reported as an import, and the hit was the module's path as a string key in a seam registry.
  - **A witness that fired on a filter that could not see.** A prefix filter over a 38-file diff
    returned zero hits on the answering path, and its witness correctly caught `src/live/turn/review.ts` in an
    earlier range. The prefix list covered `src/outbound/slack/` only, so it was blind to
    `src/outbound/github/docsBudgetSweep.ts`, the file `listen status` had graded as drift. "Zero hits" reached
    the next chair's boot doc as the reason a respawn was held.

  Two of these happened after the pattern had been named, one inside the mechanism built to catch
  it: knowing the class confers no immunity, because it is what an instrument does when nobody states its
  question. **The technique:**
  - Write the question next to the answer — the ref, the bound, the set: "no match in the 50 rows `list`
    returns", never "free"; "my branch head is behind", never "I cannot verify".
  - Prove the check can SEE, not only that it can FIRE: name the set the claim is about and show the filter's
    scope contains it, ideally by running it on the item a canonical grader already flagged. A witness drawn
    from a range it is known to cover proves nothing about the range in question.
  - The witness uses the SAME scope expression as the check. In zsh an unquoted `$SCOPE` holding several paths
    is not word-split, so `git grep … -- $SCOPE` searches one nonexistent path and every row reads `(none)`,
    while a witness spelling its path literally fires. Use literal paths or an array (`scope=(a b)`).
  - Match a FIELD, never a word that can appear anywhere in a document (`'"merged": true'`), give a wait loop
    its losing arm (`'"state": "CLOSED"'`), and trace `from ['"].*<module>` for a dependency.
  - Count before asserting absence (`| wc -l`); `head -n` turns a cap into an apparent count.
  - Gate on the claim, never on the presence of a check. When a prose rule becomes a gate, reconcile what
    accumulated before it, or the gate makes the existing damage invisible instead of fixed.

- **`lookup-answers-a-different-question-in-the-right-shape`** — sort every lookup by HOW it fails. One that
  refuses costs a retry; one that answers in the right shape with the wrong value costs everything built on it,
  and there is no red to distrust. Across two seats and four lookups, three refused loudly and cost a retry
  each; the fourth returned a number and survived. `find <dir> -name '*.md' -newermt '<local timestamp>'` reads a
  bare timestamp as LOCAL time, so at UTC+10 it returned 21 files where `'<timestamp>Z'` returned 4; a
  peer reproduced the same ratio. The wrong figure argued for re-cutting a frozen page and named as new a file
  that predated the watermark. Tools that refuse, and can be trusted on a miss: `SendMessage` to an unknown
  agent, `cmux list --json`, `git cat-file`, `slopweaver handover lint`. Tools that answer, and get re-run:
  `find -newermt` without `Z`, `grep | head -n`, any presence-only gate. **The technique:** put the unit inside
  the argument (`Z`, `--utc`, an explicit base) rather than trusting a default; sanity-check the CARDINALITY,
  because magnitude is the one thing that looks wrong when the shape is right ("21 of 139 files since a
  50-minute-old watermark" claims 15% corpus turnover in an hour); quote the invocation with its units when a
  count drives a decision; and treat a peer's number as a claim, triaging on whether the VERDICT moved.

- **`integrity-check-reads-unknown-as-unchanged`** — a boolean integrity check collapses "could not establish"
  into "fine". Three consecutive Codex review passes on one fan-out property, each one
  layer deeper: the quote check joined a record's title and text, so a phrase straddling the seam passed; the
  shard digest hashed DECODED lines, so a lossy UTF-8 decode let two byte sequences hash alike; and an
  unhashable file returned `undefined`, read as unchanged, so `chmod 000` after the readers ran passed and
  exited zero. None was visible to the existing tests or to re-reading the code; each surfaced as a BROKEN
  verdict with a runnable counterexample. **The technique:** keep three states apart — nothing to check, did
  not look, looked and failed — and make "did not look" its own branch that REFUSES, as `src/retrieval/fanout.ts`
  now does with a `null` digest. Before claiming what something refuses, run adversarial review passes until
  one comes back clean; a BROKEN pass is worth more than a first green one.

- **`one-item-failure-sinks-the-whole-batch`** — a batch stage returns `err` on one item, and the caller loses
  every item. `src/live/slack/fileDownloads.ts` failed the whole read on the first attachment Slack would not
  serve, so one file discarded a 22-message thread; fixed, with the case rewritten to its
  intent in `src/__tests__/unit/live/slack/download.test.ts`. The argument was already written twice in the same
  directory: `filePlan.ts` pre-skips canvases for this reason, and `blockFiles.ts` keeps a `files.info` failure
  non-fatal. The same defect one layer up: a grounding failure threw a bare `Error` with a whole
  `CoverageManifest` in scope, and the failure card inferred "the world model was never read" from the ABSENT
  manifest, contradicting the checklist two lines above it. `TurnQueryFailure` and `coverageOfFailure`
  (`src/live/turn/runContract.ts`) carry the manifest across the throw. A door refusal carries
  none however much was read, and printed the same false sentence, so `missingCoverageNote`
  (`src/live/turn/failureCoverageNote.ts`) states what the card knows — no manifest — for a composed answer.
  **The technique:** ask whether one item's
  failure is evidence about the others; usually it is not, so it is a per-item outcome named in the evidence
  model, in `warnings` and beside the item, with three separate counts — retrieved, skipped by rule,
  unretrievable. A refusal about the DESTINATION stays fatal. When a throw crosses a boundary that already
  measured something, carry the measurement in a typed error, because inferring a fact from an absent field
  turns every upstream discard into a confident false claim downstream. A test named for the old mechanism is
  rewritten to its intent, never deleted.

- **`two-normalisers-decide-sameness`** — two functions both decide whether two values are the same thing, and a
  rule keyed on sameness consults the wrong one. In the store's identity reconciler, five Codex rounds
  produced five counterexamples to "an untrusted email never auto-links". Four were the identity KEY drifting —
  an early return skipping the refresh, per-entry refresh losing to source order, a login-keyed row invisible
  to a numeric-id lookup, a rename leaving a historical row. The fifth was bronze lowercasing and trimming
  while the ladder also stripped plus-tags and Gmail dots, so three spellings of one mailbox were three set
  members. **The technique:** rekey a "this value must not be used" rule on the VALUE, not the key that reached
  it, and re-apply it to stored data every run; one function decides sameness and every rule depending on
  sameness calls it. `normalizeEmail` (`src/store/identity/matching.ts`) is that function for the store, and
  [`--person` resolution](../store/history-load-and-full-text.md) reuses it rather than restating it in SQL. The
  silver lookup's `normaliseEmail` (`src/silver/personLookup.ts`) is a second, narrower definition that
  keeps the local part; a rule spanning both layers picks one, explicitly.

- **`single-use-constant-handed-over-as-current`** — a constant naming a live process, instant, PR or arm is
  correct exactly once, for the session that writes it. Measured on the listener handover chain,
  where each cut re-skins the last cut's scripts with a `sed` over slugs that never touches NUMBERS: three
  consecutive cuts were handed predecessor pids two generations old, each time after a handover message said in
  good faith they had been updated. Each session's patch was right for itself and wrong for its reader, which is
  why the class regenerates through careful work and a warning cannot fix it. The rename also minted a false
  OWNERSHIP claim (a comment calling the predecessor's pids "MINE"), and a hand-incremented "Nth clean
  handover" count was off by thirteen against `arms.jsonl`. **The technique:** a `--preflight` gate inside the
  file it guards, run while the referent still EXISTS (at boot, predecessor still armed) — run at consumption
  time a stale constant reads green and the mistake is unrecoverable; fire-check it against the known-bad value;
  delete the prose warning beside it; carry the command that derives a number, never the number. After a
  mechanical re-skin, check the text still says something TRUE about who owns what, not only that no old token
  survives — a residue grep is blind to attribution. Read a ledger row's reason, never its count: of the
  chain's eleven `died` rows, ten were an orderly `superseded` and one a real `process-dead`. An absence
  check needs a positive control taken while the thing is present: a null read of a key that is never there
  proves nothing.

## Filed against an existing class

**Absence asserted from one guessed path** is an instance of `unverified-absence-impossibility-or-blocker`
([survivors](survivors.md)), recorded here because its remedy is this family's. A dotfile audit
called `~/.zshenv` comments stale because `~/dev/acme/acme-admin` does not exist; `~/dev/acme-admin` does, with
eleven worktrees beside it, so the comments were right and the finding recommended changing correct config. A
negative reads as cheap and skips the verification a positive gets, and the org-flavoured path is exactly the
plausible guess that returns a confident false negative. The technique: search the plausible parent
(`find ~/dev -maxdepth 4 -name '.prototools'`) rather than stat one constructed path, and cite that search as
the evidence when the negative carries a recommendation.
