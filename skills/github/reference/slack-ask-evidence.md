# Why only the Slack corpus can carry a `no`

How `github review-state` and `github landing` decide an ASK is absent, and the one thing that would make
that decision a lie. Split out of [review-state.md](review-state.md), which says how to read the verb; this
says what its Slack legs are allowed to claim.

**Only the CORPUS leg can carry a `no`, and this is the correction that matters most.** Slack's own
`search.messages` collapses proximate matches by documentation, and WHICH one it returns is not stable.
MEASURED on one pull request: two messages minutes apart in one channel both linked it, the
search returned the one carrying no mention run, and the verb reported "nobody has been asked" about a pull
request the owner had that morning asked two named people to review. A later identical query returned the
OTHER message. So the live leg contributes POSITIVE findings only; the exhaustive line-by-line corpus scan,
which has no collapsing, is what a `no` rests on. Three consequences:

- A stale corpus yields `unknown` where it once yielded `no`, which makes `slopweaver refresh --source slack`
  the thing that buys a confident absence.
- **A live match newer than the corpus watermark proves the exhaustive leg is behind** and forces `unknown`
  on its own, whatever the watermark comparison says — UNLESS the run went back and READ AROUND it (below).
  The read checks itself rather than trusting a stamp.
- **A scan that could not list the bronze lends no watermark**, so it cannot say `no`. The live leg reads every
  page Slack names, up to five, and an incomplete or failed search is named in the residue.

**A hit is an ANCHOR, so the run goes back and reads around it.** Collapsing is defined by proximity to the
match Slack returned, so the collapsed sibling is either in that hit's own thread or adjacent to it in the
conversation — and both are readable. `src/review/slackNeighbourhood.ts` treats every live hit as a place to
go and look: `conversations.history` over exactly the corpus's blind window (`[watermark, now]`), each
anchor's own thread and every thread active in that window in full, all judged by the same exact matcher the
hits themselves went through. That is what recovers that ask, and a conversation read that way stops
its own hits forcing `unknown`. Four bounds, each stated in that module's header: the walk needs a watermark
to start from, it is capped at 12 conversations, 24 threads and 10 history pages, ANY failure withholds the
whole window rather than shortening it, and a reply under a root older than the window is invisible to
`conversations.history`. **The other refusal is untouched** — a window is ONE conversation, so a corpus that
does not reach the pull request's own last activity still cannot carry an absence, and widening that is the
owner's ruling to change.
