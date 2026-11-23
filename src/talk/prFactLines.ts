/**
 * The pull-request-fact lines both Talk prompts carry (`./sessionConfig.ts`): merged, landed, closed, already in or
 * superseded is said only off a live read made in the same turn, named as such; without one it is the card's claim.
 *
 * The incident, a console call: the voice asked the owner whether to close a pull request "because the original
 * change is already in", and later said "I said it had landed, but that was just the card's claim, not something I
 * checked". The claim was TRUE — staging had held the line since an earlier pull request — but the console pull
 * request page the owner had open drew an open +1/−1, so a true claim read as a lie and they could not tell which it
 * was. Repro: `jq -r 'select(.kind == "segment" and .final and .who == "voice") | .text'
 * $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl | grep -n "already in\|card's claim"`.
 *
 * "Already in" needed a receipt nothing printed before: GitHub's own diff is against the branch's merge base, so an
 * open +1/−1 says nothing about the base today. `github read --files` now carries `data.diffOnBase`
 * (`src/live/github/diffOnBase.ts`), and the console page draws the same answer, so what the voice says and what the
 * owner sees are one read.
 */

/** The voice's lines, beside its rule on counts: a pull request fact is the thinking model's live read, or the card's. */
export const PR_FACT_VOICE_LINES: readonly string[] = [
  "Never say a pull request merged, landed, closed, is already in or was superseded unless the thinking model read",
  "it live in THIS turn and says so; then say where it came from ('GitHub says just now it's already on staging').",
  "Otherwise it is the card's word, said as that: 'the card claims it already landed'. Never upgrade a card's",
  "claim to a fact, and when the thinking model says it could not check, say that instead.",
];

/** The thinking model's bullet, beside its rule on counts: which read is the receipt for which fact. */
export const PR_FACT_BACKEND_LINES: readonly string[] = [
  "- A pull request fact — merged, landed, closed, already in, superseded — is stated only off a live read made in",
  "  THIS turn, and the answer names it ('GitHub, read just now, says …'). merged or landed: verb github read <url>",
  "  --json says state MERGED, with its mergedAt. closed: state CLOSED, with its closedAt. already in: verb github",
  "  read <url> --files --json, whose data.diffOnBase.verdict is on-base — every change in its diff is on the base",
  "  branch's current tip, even when GitHub still draws an open +/− against the old merge base; partly, not-on-base",
  "  and unknown never mean already in, so say which, and unknown's reason. superseded: only when a live read of",
  "  the successor shows it merged or open. When a card or row turns on one of these ('close it, it's already in'),",
  "  read it before you speak about the card. A card, row, summary, earlier turn or memory is never the receipt:",
  "  with no read this turn, say 'the card claims …', never the fact. Never read the base tip's hash aloud.",
];
