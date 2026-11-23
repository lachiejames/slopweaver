# Concurrency does not cause the failures — the correlation runs backwards

Part of [Why planning passes did not converge](../codex-plan-convergence.md).

§5 of the brief established that passes from separate sessions genuinely overlap, and asked whether that causes
the failures. It does not. Each record's finish time and duration give its window, so overlap is derivable for
the whole population rather than from one A/B pair:

| concurrent passes | plan n | plan concluded | review n | review concluded |
| ----------------- | ------ | -------------- | -------- | ---------------- |
| alone             | 16     | 56.3%          | 27       | 85.2%            |
| 1 other           | 14     | 64.3%          | 45       | 93.3%            |
| 2 others          | 17     | 70.6%          | 74       | 95.9%            |
| 3+ others         | 27     | 85.2%          | 199      | 95.5%            |

A pass running alone concludes LESS often than one running alongside three. **This is confounded and must not
be read as "concurrency helps".** The plausible confounder is obvious: a solitary pass is usually someone
debugging a new prompt shape, while a 3+ fan-out is one settled property replicated across a properties file.
The honest conclusion is the negative one — there is no signal here that would survive the A/B experiment §5
proposes, so that experiment is not the first thing to spend a bound on.

The `UNATTRIBUTED: N recorded pass(es) captured no branch` ledger line has a simpler cause than cross-session
confusion: the record has no branch field at all, only `repoRoot` and the tree capture.

**A separate, real gap stands:** a pass killed externally writes no record, so it is invisible. The recorded
failure rates are a floor. (The 277 record-less directories are NOT that gap — they predate `record.json` and
all carry an artifact. That was checked rather than assumed.)

## §4 was right: "never raise the bound" was wrong for planning

"When a run does not converge, narrow the property; never raise the bound first" is correct for a review
property. For a planning pass the evidence is against it: all three `no-conclusion-in-bound` plans used their
whole 25-to-30-minute bound, and the narrowing recorded in the brief halved the prompt and still did not
finish inside the same bound. So `skills/codex/SKILL.md` and `docs/codex-orchestration.md` split the advice
by arm, and the artifact prints the arm-appropriate next step with the salvage beside it so the reader can
tell "needed more time" from "the prompt was the problem".

## Where the review loop stops

The tenth finding is a counterexample deliberately NOT fixed, and the stopping rule is the reason. Its root is `/r:'x` — a
directory whose name contains both a colon and an apostrophe — reached through POSIX quote concatenation
(`'/r:'\''x/a'`). Closing it means implementing shell quote semantics, which is the one thing
`src/codex/tripwire.ts` says in its own header it will never be: a parser. Every fix that came before it either
generalised or corrected; this one would add a shell tokeniser to a heuristic whose stated contract is that it
guesses, never aborts alone, and errs toward silence.

**A finding the author has read and deliberately declined is a NAMED LEFTOVER.** After the first review pass a
BROKEN verdict on the current tree fails with _"r1 is CURRENT and BROKEN — fix it, then take the second and last
review pass over the fixed diff"_. After the second (the owner's ruling: at most two), a BROKEN still
standing is a leftover instead: `codex status --check` passes and prints its line, and both landing verbs refuse
until it is acknowledged as `codex-loop-incomplete` with a `--reason`, written to the door ledger
(`src/codex/reviewLeftovers.ts`). For nine of ten passes the BROKEN was the right pressure and produced nine real
fixes; the tenth asks for a shell parser, and is landed acknowledged, where its reason stays findable.

## Found and not fixed — triaged

- **The tenth finding: a root containing a colon AND an apostrophe, shell-quoted.** Produces a false abort. Needs POSIX
  quote semantics, which the tripwire's own header rules out (above).
- **`slopweaver codex review --help` under-reports its own flags.** `REVIEW_USAGE` in
  `src/cli/commands/codex/core.ts` is complete; `src/cli/manifests/codex.ts` hand-copies a stale variant
  omitting `--properties-file` and `--concurrency`, and that is what prints. Same class as the `refresh --help`
  defect, so the `helpTruth` ratchet has a hole. **Owner: a `helpTruth` follow-up.**
- **A pass record carries no branch and no writer identity.** That is why the ledger cannot attribute a pass,
  and it is the same missing-identity shape as the handover ledger's lack of a writer. **Owner: whoever next
  touches `CodexPassScope`.**
- **A killed pass writes no artifact at all**, so every recorded rate is a floor. Fixing it means writing a
  record before the pass starts and updating it, which is a different design from write-once-atomically.
  **Owner: unassigned — needs a decision, not a patch.**
- **Property authorship bias** (appended to the brief by another session): a `CLEAN` from a property the
  implementer wrote can mean "the question I chose has a reassuring answer". Measured there: three CLEANs, then
  a reworded pass found a real defect in the same code. Out of scope here; the proposed control — author
  properties in the orchestration doc, before the implementation — is a process change, not a code one.
- **`fatal` on the review arm is 11 of 12 fatals and all r3.** Every one is `the Codex transport failed` with
  no detail, at 22–69% of bound. The diffs were large, but there is no within-branch contrast in the sample so
  size is untested as a cause. Worth an owner; not this one.
