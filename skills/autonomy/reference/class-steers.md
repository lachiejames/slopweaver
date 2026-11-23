# Class steers — the owner's standing word on a whole kind of act

Reading a list of more than 600 check-ins, a lot of them ask the same question, and where the owner has given a clear
steer on a class of questions the fleet does not have to keep asking it; those steers are applied throughout
everything in that list, and the owner then reacts to what is left.

So a word the owner has given on a KIND of act is recorded once, as a class steer, and every act of that kind
reads as settled by it — recorded before the note or after it. The owner's Alignment page
([alignment](../../../docs/console/alignment.md)) then carries only the kinds they have not ruled on.

## Recording one

```bash
slopweaver autonomy steer-class self-merge-own-prs \
  --kinds press-merge-when-ready,land-own-pull-request,enqueue-own-pr \
  --steer "<the owner's words, verbatim>" \
  --anchor "transcript:<session>#<turn>" \
  --by-session "<the session writing it down>"
```

- **`--kinds` is an exact list, never a pattern.** `kind` is an open vocabulary, so a pattern would settle a
  kind nobody has read yet. Read the live spread first — `slopweaver autonomy list --unsteered --json | jq -r
.action.kind | sort | uniq -c | sort -rn` — and name each synonym the owner's word actually covers.
- **Re-recording a class REPLACES its list.** The latest row per class is the whole current list, so dropping a
  kind hands those acts back to the owner. Where two classes name one kind, the class appended later governs it.
- **A word on the act itself outranks the class**, whenever it was given: a later `autonomy steer`, then an
  inline `--steer`, then the class. One word from the owner that an act went out with broken links survives a
  class of approvals.
- **Only the owner's words, and only kinds they cover.** A kind whose question the owner said they still WANT —
  raising an internal finding, a Slack post as the owner to people — stays off every class until the owner says
  otherwise.
- **`--subject-prefix` narrows a class to one place** when the owner's word covers a kind there and nowhere
  else. One ruling lets the fleet post as the owner in the owner's own bot DM, so that class carries
  `--subject-prefix https://acme.slack.com/archives/D0SYN000001/`, and the same `slack.post.as-me` kind
  aimed at a channel stays the owner's. The prefix is a LITERAL, matched with `startsWith` and case-sensitive: an https
  URL through at least its host's slash, or `state:<path>`. A later scoped class that does not admit an act
  falls through to an earlier class that does, so a scope never hides a broader word. A prefix proves only
  where the subject lives: `https://github.com/acme/` does not prove a pull request is the owner's.

## Why it is written as a steer row

The row is `{ actionId: "class.<classId>", steer, steeredIso, bySession, kinds, anchor }` — a steer on an act
that will never exist. A seat runs its OWN tree's code against the shared home (`.claude/rules/area-cli.md`
§ A seat's verdict is its own tree's verdict), and an older build refuses the whole register on one line it
cannot parse. That build reads this row as a steer on an unknown act and drops it, so a stale seat keeps its
`autonomy list` and `autonomy record`; the fleet store mirrors it as an ordinary steer. No act may take the `class.` prefix, and the prefix alone decides: a per-act steer carrying a stray `kinds` or `anchor` still reads as the steer it always was (`src/autonomy/row.ts`).

A scoped class is `{ actionId: "class-scoped.<classId>", …, subjectPrefix }` for the same reason one step on: a
build that knows `class.` but not scopes would ignore `subjectPrefix` and settle the kind everywhere, while
`class-scoped.` reads to it as a steer on an unknown act, which settles nothing. The two spellings pair strictly
— a `class-scoped.` row without a scope, or a `class.` row with one, is refused — and one class NAME spans both,
so re-recording a class with or without a scope replaces it.

## One word per PATTERN: one card, and one grade settles every act in it

The ledger keeps one row per act; the register and the Alignment page read one PATTERN per kind of act joined by a
shared subject or an identical `said`, joined through one another so membership never depends on ledger order
(`groupPatterns` over `autonomyPatternKeys`, `src/autonomy/query.ts`; mirrored by `groupActs`,
`site/lib/actGroups.ts`; both held to one table, `src/__tests__/fixtures/autonomyPatternCases.ts`). Two occasions
made it. One pull request sat on the owner's list twice, as `<number>-enqueue` and `<number>-requeue-…`. And
seven acme-admin security-bump rebases each asked the owner, who pointed out that a standing instruction already
sounded like it should have cleared them all off the queue, and asked which it was.

The newest act governs. The owner's word on it — one `autonomy steer`, one row — is projected by `foldAutonomy` onto
every earlier act as `patternSteer`, never written as more rows, so `--unsteered`, the Fleet Briefing, the
Alignment page and the voice all read the pattern settled. The earlier acts fold under the one card, reachable by
their `act:<id>` links; a word only on an earlier act does not settle a later one, and a word on the act itself still
outranks the pattern's. A later unsteered act of the pattern becomes its new governor and is asked about again.

**A spoken verdict on the console voice is one word on many cards, never a class.** The owner's ruling: the
voice walks the owner's check-ins and each reaction clears a batch. `talk relay --about act:<id> --covers
rule|this` writes the owner's heard words as an `autonomy steer` on the governor of every card of that act's kind in the
same place (or of that one card), under `talk:<turnId>`, and nothing for the acts still to come; a relay not stated
whole writes nothing at all (`src/talk/relayCutHold.ts`) (`src/talk/checkInRuling.ts`, [the walk](../../../docs/console/voice-context-and-calls.md#the-check-in-walk--the-voice-reads-them-unasked-and-one-verdict-clears-a-rule)).

**A standing word is structural, never prose.** An act done under a rule the owner already confirmed leaves
the owner's list only through a class steer (the whole kind) or `autonomy record --steer "<the owner's word>"`
(this act), with the
prior act or anchor cited in `--why`. A `--why` citing "the standing rule" and nothing else settles nothing: no
act disappears because its note resembles a citation.

**An identical `said` is one pattern, whatever it names.** A templated line — the finding-PR recorder's "I
opened a pull request for a problem the fleet found itself …" — folds every act carrying it into one card, and
the owner's one word grades them all. A word the owner wants to give one of them is an `autonomy steer <id>` on that act. A
pattern never spans two standing rules: the sentence joins acts only under the same governing class, or none, so
an act a scoped class settles is never folded under a card still asking about one it does not cover.

**Each rule names what it cleared.** Applying every standing approval rule the owner has already given is what cuts a list of 353 check-ins down to the target of 100. A card a class settles leaves the list and is counted
under that class — a chip, "N settled by your standing rules", on the Alignment page beside its act count, and one
closed fold listing each rule, its count, the owner's words and anchor, and its cards (`site/lib/standingRules.ts`). Those
cards are built by the same builder as the acts drawn there and filtered by the same work context and tags, so the
two counts are one list.

**The list is only as current as the code that read it.** The console launches `bin/slopweaver` with its code
root pinned to the tree serving it (`consoleChildEnv`, gated by `console-verb-binary`). Before
that, a console restarted by `checkout sync` from a seat standing in an older worktree ran that worktree's
`autonomy list`, which printed no class steers, and the list regrew to 673 without a single row changing.
