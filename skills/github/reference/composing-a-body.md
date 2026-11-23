# Composing a C3 description

The SHAPE of a pull-request description is the C3 form, and the gates own it ([pull-requests](pull-requests.md)).
The SENTENCES are the half no gate decides, and this page is that half. `github stack push
--file-example`/`--form-example` and `github pr update --pull` print a short brief of it before you draft or recut
(`src/outbound/github/voiceBrief.ts`), the way `slack voice-rules` briefs a Slack draft.

## The test

Every cell earns its place against one sentence: a good PR shows the owner that there is a real problem, that this PR
makes code changes to solve it, with proof the owner can trust of how it did so, and that it takes little cognitive
effort to understand what the owner is looking at. A cell that does not help show the problem, the change or the
proof, quickly, comes out.

## Before you draft

Run `slopweaver slack voice-rules`. It prints the owner's response shape and the exact rules every above-fold cell is
already gated on. The brief does not copy that shape, because it lives in the owner's own profile, not this
repository.

**What carries from the owner's Slack voice:** lead with what, never the how. No riddles, say the thing. One fact per
sentence. One light hedge per claim, because a hedge is the owner's correctness guard. Plain words a reviewer does not
have to decode.

**What does not:** the Slack word ceiling (each cell has its own cap, which the door refuses past), drip-feeding,
one-message-per-channel, lowercase, and the `yo`/`hey` openers.

## Attribution

- **No first person and no first-person plural** in prose, titles, commit messages or captions; code and quotes
  aside. The subject is the change, the code or a named role: "the pin is the only reason it is vulnerable", never
  "we pinned it".
- **The owner is "the owner"**, every time. A one-off act (a sign-in, a live run, a screenshot) names "the owner" or
  "an agent", which is what `runBy` and `problemSeen.by` record, or `unrecorded` when nothing records who ran it;
  anything anyone can re-run names no actor. Never a
  model, session, thread or transcript id: installation state is never published.
- **An opinion carries "probably", "likely" or "unverified".** Nothing about the owner's circumstances.
- **Naming who ran an act and keeping an account out are two rules, and both hold.** "The owner ran the backfill"
  is attribution, never a circumstance. What the run read off the owner's own account is: that account's figures
  (how many chats, rows or messages it holds) never appear. A count of what code or a review did (requests per
  run, review passes on a pull request, a fixture's rows) is not an account's figure, and the number that sells
  the change comes from there: "every run listed the whole history before reading one chat", never "listed all
  1,204 chats".

## The explainer

At most 70 words, and the first thing a reviewer reads after the badges. **Its first sentence names what broke and
for whom.** Then what this changes. The one number that sells it goes first, in plain sentences. A mechanism comes
last, if at all, because a mechanism is what a reader has to translate into a reason to care.

> People exporting widgets lost the last entry when a sheet ended on a blank line, so **1 report in 40** came out
> short. This keeps that entry and refuses a sheet it cannot read.

Five of the owner's calls on the explainer and title are refused at the door and in CI, in a layout-2 body:
Slopweaver's own words (seat, handoff, chain, seed, register, door, lap, row, relay, projection) outside a code run
(`TEAMMATE_WORDS`; a table "row" is refused too, a false positive the owner accepted); an opening on "Anyone",
"Any install" or "Everyone" rather than on who it hit (`AUDIENCE_UNNAMED`); bold that is not a figure of at most
four words (`BOLD_NOT_A_FIGURE`); a file name, flag, variable or `slopweaver`/`yarn` command as plain text
(`CODE_UNFORMATTED`, every cell); and a bare commit id rather than a link (`COMMIT_UNLINKED`, every cell).

## The cells the badges read

The three hovers are built from cells you write, so write those cells to be read in a hover of at most 200
characters, plain text.

- **A risk item's `worst` is an outcome a reader pictures** ("an export refuses a sheet it used to read"), never a
  property of the change ("a parser branch is unreachable"). The TOP item's `worst` and its check, or why nobody
  checked, ARE the risk hover: `Worst case <worst>. <check>.`. Pick the item's KIND of worst case, which sets the
  level ([pr-badges](pr-badges.md)); the kind is never printed, only the level it implies.
- **The problem's seen line** (`what`) is the problem hover after `Seen <day>:`. Lead with what was seen, in words a
  teammate reads without the fleet's vocabulary: "the nightly export was one row short", never a file path or a verb
  name first. A problem nobody can re-observe on demand is still seen, on the day it was observed.
- **A proof slot's reason is quoted by the proof hover** when that slot has no screenshot, so a proof slot's reason
  is at most two sentences: why there is no screenshot, then where the proof is instead. The second is optional ("The
  unit cases below are the proof."), each sentence is one fact, and a reader accepts both without opening anything.
  A result goes in a check and an unrun check under Not checked; a third sentence is refused as
  `PROOF_REASON_SENTENCES` before any review. The reason is judged on whether it is true of the change, never on
  whether a capture should have been gathered: that is the landing grade's question ([pull requests](pull-requests.md)).

## The proof slots and checks

- **A screenshot sits under the one line it proves**, at most 25 words, starting from where it was taken: "On this
  branch, `widgets export` keeps the last row." Proof of the problem is the product itself failing on screen; a
  vendor's doc can be linked as cause, never as proof.
- **A proof slot holds a capture, never a sentence about a test.** Where a command shows it, capture that command
  failing on main and passing on the branch with `slopweaver browser terminal-shot`; a reason that talks about a
  test is refused (`PROOF_IS_TEST_SENTENCE`), and so is one reason in both slots (`REASON_REPEATED`). A slot with a
  reason renders its heading as `Proof of the problem: not shown`.
- **A check is one sentence with no screenshot**: what was checked and what it showed, under `## Checks` as a list.
  A group of checks is a label with its checks nested under it, the base checks everyone shares first
  (`checkGroups`; in an authoring file, a `- <label>` bullet with ` -` bullets under it). Lint, typecheck or a gate
  passing, or work left to CI, is CI's own check list and is refused (`CI_WORK`). Anything not checked goes under
  Not checked, and why, as a short phrase and a reason; that reason is the artifact a reviewer can disagree with.
- **Re-run holds only what re-runs it**: commands, test lists, a short note. Nothing a reviewer must read to judge the
  change belongs in the fold.

## The title

A conventional commit, and the words after the colon say the outcome, never only the mechanism
([pr-titles](pr-titles.md)). `dx(ABC-840): show the integration suite's logs when a test fails`, not
`[ABC-840] lift the integration suite silent logger`. The title also derives the kind labels.

## Composing every cell

- **The fact that most changes a reviewer's verdict goes in the FIRST sentence**, not the chronology or the biggest
  number: "the pin is the only reason this is vulnerable" on one measured pull request, "none of the vulnerable call
  sites exist in this code" on another. Both were once below the fold, one four folds down.
- **One fact per sentence.** Splitting took the worst measured sentence from 36 words to 14. Length is not the
  target: one rewrite came out a word LONGER and read far better.
- **Do not name every item of a taxonomy above the fold.** Three vulnerability kinds cost 14 words that changed no
  verdict.
- **Never make the owner do arithmetic.** "knip flagged 428 and 117 were kept" beats "cut 428. 117 came back", which
  leaves the reader to subtract.

There is no gate behind which fact leads. That stays a judgement, as
[area-outbound](../../../.claude/rules/area-outbound.md) says; the attribution rule is the one part a scan refuses
where it can be computed.
