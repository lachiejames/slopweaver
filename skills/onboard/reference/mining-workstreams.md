# Mining their history into candidate workstreams

Onboarding should end on a view, from all of the person's history, of what is important to them, what is
stalling and where they need to loop in people — and the page **reveals to the person what they
want**, never a task list. The mine is a pass THIS visible session makes (rule 2: no headless model), written
through one verb. Every field and ledger: [the workstreams candidates reference](../../workstreams/reference/candidates.md).

## When

```bash
slopweaver onboard workstreams          # pull | mine | react | answered, whether to reveal, what to do next
```

It reads what each source holds and what the last mine wrote. The human form exits 3 at `pull`, while no
source holds anything and nothing has been mined; `--json` prints that same `pull` reading and exits 0, its `held` naming every source with the bytes it
holds, zero included, so a reader tells a fresh install from a failed read. A source directory that exists but cannot be
listed exits 1 in both forms, never a zero; the verb sizes files by `stat` and never opens them. `reveal` is the counted step (workstreams
mined); `next` is the uncounted action to take. `mine` means a source holds records no mine has read,
or a proposal of theirs is unread; run it after step 8 and again whenever a source joins. **One source alone is
enough** — Notion first still yields candidates worth reacting to. While a source is still pulling, its live state
is the corpus-sync view's to show (companion row `more-visibility-of-scheduled-asks-and-corpus-sync`), never a
spinner here.

## What to read

Read EVERYTHING reachable in each pulled source through the store verbs (`store read`, the atlases), never a
sample: what the person wrote, what they were tagged in, what they decided, what they proposed. A candidate is
something they would recognise as theirs to drive. Read their earlier steers too, so a candidate shows the ones it
answers. Read every unread proposal (`workstreams candidates --json`, `proposalOwed`) into a candidate with
`proposal` set to its id.

## What to write, per candidate

- **Evidence: the person's own words, verbatim, dated, linked.** Two or three quotes. Never a paraphrase — _"I
  really like seeing stuff quoted back … I remember being there, saying that"_. A Notion quote links its page.
- **Two or three definitions of done**, each with its trade-off and, where there is one, a **stretch** rung beyond
  the floor (often a public sentence from someone else). At least one judged by its **people** — the team across
  it and owning it; offer **adoption** (teammates reaching for it unprompted), a measured **sentiment** in the
  channel that complains, or a chore's measured **absence** where the evidence points there.
- **What looks stalled**, and since when, from the evidence — or null.
- **The owning team** and, apart from it, **who the first conversation is with** (`loopIn`), each with an opener in
  their own voice. `workstreams loop-in` parks it on the Queue; nothing is ever sent.
- **`evidenceCount`** is how much of their own words back it: the page opens on the top three by it, the rest
  behind one link.

Then `slopweaver workstreams candidates-put --file <candidates.json>` with `minedSources` naming each source read
and how many records. It refuses dropping, renaming or re-numbering an answered candidate, so re-mining is safe.

## Then

Send them to the console's `/workstreams#candidates`. Every press there writes the same ledgers a relayed word does.

## No setup page

The console has no Setup page and no first-run flow. Its only setup surface is Settings → Models,
which connects the plans it runs on; history and candidates show up on the pages they belong to,
`/workstreams#candidates` included. Nothing asks about their voice, which is learnt from their sent Slack.
