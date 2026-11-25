# Who a pull request is on the hook with, and a suggested reviewer

The owner's ask: every open pull request should say, prominently, who was asked, where, when, how long ago and
whether to ask again, and, when nobody usefully is on the hook, suggest somebody from the owner's own past picks
with a way to approve the pick or say why not. The console's pull-requests page draws all of this. These are the
verbs underneath it.

```bash
slopweaver github reviewer list --json            # one row per open PR in the LAST landing reading
slopweaver github reviewer pick --repo acme-admin --number 17560 --reviewer U0… --verdict approve --by-session work-console  # parks the ask
slopweaver github reviewer pick … --verdict decline --feedback "owns the API, not the web app" --by-session work-console
slopweaver github reviewer read --repo acme-admin --number 17648 --message <permalink> --ask --to U0…,U0… \
  --quote "<@U0…> <@U0…> got another batch of these" --by-session <workspace>
slopweaver github reviewer read … --non-ask --why "an instruction to the bot, not an ask" --quote "<line>" --by-session <workspace>
slopweaver github reviewer backfill --repo acme/acme-admin --author <login> [--apply]   # history from the corpus
```

## A suggestion on every ask, and a suggestion is all it is

**Every ask that reaches the owner carries a suggested person**, even where the owner names the reviewer
directly. The owner's ruling gives two reasons: the owner can correct it and gain confidence over time that the reviewer
picker heuristic is accurate, and it sometimes saves the owner time as patterns emerge. So it is phrased as a
suggestion, settled one word at a time, and a `decline` with its `--feedback` is the correction the tiers
below learn from. A user-group mention is never offered as the follow-up to a silent person
(`src/review/cadence.ts`): it reaches people the owner never chose.

**Routing is advisory, never a merge gate** (the owner's ruling, off the owner's own edge case: a router picks
two reviewers, one says "ask someone else", and the pull request is unmergeable despite two other
approvals). The hard gate stays at codeowner approval plus green CI. Rulesets target ref names, not pull
requests, and a per-pull-request ruleset needs an admin token in CI and races, so enforcement is not built.
The owner reviews what reaches the owner as a Slack tag (GitHub's own reviewer requests are ignored; the owner
reviews a PR only when tagged in Slack), which is why no row here is enrolled off GitHub's own reviewer-request field
([review-state.md](review-state.md)).

## The register

`$SLOPWEAVER_HOME/ledgers/reviewers.jsonl` is append-only and has three row kinds (`src/review/reviewerRegister.ts`):

- `asked`: one certified ask on one pull request, with its Slack recipients and the `@org/team` code owners GitHub
  named at the time. **`github landing --record-reading <by>` writes these**, deduplicated on `prKey|messageKey`, on
  every run that records a reading, so the tick and the pull-requests page's own refresh keep the register current. Asks on pull requests
  that closed before a recorded reading saw them come from `backfill`, below.
- `pick`: the owner's verdict on a suggested reviewer, `approve` or `decline`. **A pick sends nothing.** An
  approve then parks the ask: one message as the owner, a DM to that person linking the pull request, through
  `slack draft record`'s own gates (`src/review/reviewAskDraft.ts`), held on the owner's queue for the owner's yes. A held ask to the same
  person linking the same pull request is reused, never doubled. **This path does not yet check that a discussion
  came first** (lead with the discussion): a named gap, row
  `reviewer-pick-approve-skips-the-lead-with-the-discussion-check`. That covers a DM a session addressed by its
  `D…` id, which is resolved to its member with one `conversations.info` read, and a channel line that tags
  them. A `D…` DM Slack will not resolve stops the park rather than risk a second ask. An ask to a person who
  already has one held, or was sent one today, is refused as a single: a session re-cuts ONE batch DM to them
  ([the list form](../../slack/reference/the-list-form.md#where-the-ask-goes)). A park that fails keeps
  the pick and exits 1 naming why. A decline needs `--feedback`, parks nothing, and the suggestion never offers that person on that
  pull request again.
- `read`: a visible session's reading of ONE message on one pull request, an ask of named people or groups, or
  not, with the line it rests on. See below.

The reviewer must be a Slack member id (`U…`/`W…`). Neither the owner's own id nor the bot's is ever accepted.

## `list`: the hook, then the suggestion

`list` joins the last `github landing` reading with the register and the identity roster. It makes no GitHub or
Slack call. It exits 3 when no reading is recorded and 1 when the register cannot be read. The hook comes first
(`src/review/reviewerHook.ts`):

1. `not-due`: a draft, or a pull request stacked on a base that has not landed. Nobody is chased on either.
2. `picked`: an approve newer than the newest ask. The row reads "picked, no ask seen since" until a later
   reading sees the ask, and the queue withdraws its "Who on `<team>` should review #N?" card
   (`site/lib/landingRows.ts`): the parked ask is the one card.
3. `asked`: the newest ask's first recipient, which is the person a chase goes to.
4. `nobody-asked`: only when the landing verb itself answered `no`.
5. `unknown`: anything else. An old reading, or a Slack window that cannot rule out an ask, reads as not known,
   never as a confident nobody.

A suggestion comes in three tiers, strongest first (`src/review/reviewerSuggest.ts`):

1. A **named code owner**: a person the row is still `blockedOn`, resolved to Slack through the reading's
   `logins`. A leftover request to a team's delegate, once every rule is approved, is never one
   ([codeowner-requests.md](codeowner-requests.md) § A leftover request to a person).
2. **Team history**: people the owner asked on earlier pull requests owned by the same team.
3. **Repo history**: people the owner asked on earlier pull requests in the same repository.

The basis sentence for tiers 2 and 3 ends "history, not ownership". The suggestion never offers the author, a
Slack user group, a declined person, or, when a chase is due, the person who went silent. Each of them is left
out under every Slack id of the same person, since one person can carry two: `list` reads the identity roster
for that, beside the reading's own `loginSlackIds`, and one person is offered at most once. The author is known
only through the reading's login join, so when an author cannot be joined to Slack, the history tiers are withheld
(any id in them could be the author) and only a named code owner is offered.

**The tiers are history, and the owner's review-asks preference row is the lean over them** (`slopweaver knowledge
recall review ask reviewer --domain review`), never a name written here: the owner's newest word on routing replaces
the row, so a name in canon is the stale copy. The tiers do not encode it, so a session drafting the ask follows the
row and the owner overrules it in the queue. **A GitHub reviewer request is not an ask**
([review-state](review-state.md)), so it writes no `asked` row and settles no hook. Either way the ask
itself is a Slack message as the owner, to people or a user group, parked with `slack draft record` for the owner's yes ([rule
10](../../../docs/doctrine-rationale/rule-10.md#reeled-in-a-message-to-a-person-waits-for-the-owners-yes-the-owners-own-pull-request-never-does)).
An approve parks the plain one-line DM itself; a session re-cuts it (drop and re-record) only when the ask needs
more than the link, a batch or a channel thread.

## `read`: writing back what the landing could not settle

The classifier abstains (`undecided`) rather than guess ([review-ask.md](review-ask.md)), and the landing then
reads "not known who was asked" and hands the permalinks over "for a visible session to read". `read` is where
that session writes its answer down. Read the message IN CONTEXT first — `slack read-thread <permalink>`, and
the owner's own messages about the pull request (a live `github landing --slack-live` is the from:me search) — then:

- **The quote is the check.** `read` fetches the message through the Slack door and refuses unless `--quote` is
  in its text verbatim (mentions as `<@U…>`) and the message, or any message of its thread, links the pull request. A
  status line or an instruction to the bot is `--non-ask --why`, never an ask.
- **The landing honours it** (`src/review/readingMerge.ts`): a reading of a message a Slack leg found answers
  `askDecisionFor` first, as rule `visible-read`, until an edit removes the quoted line. It never attaches to a
  copy whose edited versions disagree, and a pin copy is ordered against the message's own edits like any other
  version, so a stale one cannot speak for words an edit removed. A reading of a message NO leg found adds nothing: its words cannot be re-checked. A later `read` of
  the same message supersedes.
- It sends nothing, and the page changes on the next recorded landing reading, not before.

## `backfill`: the asks the landing never saw

The landing writes an ask only for a pull request open at a recorded reading, so the register began with five.
`backfill` finds the rest in the local corpus (`src/review/reviewerBackfill.ts`): the author's pull requests from
the GitHub bronze, one Slack corpus scan for every message reaching them, the recorded `read` rows laid over it,
and the same `askTrailOf` the landing uses, so its bar for an ask is the landing's. It dry-runs by default;
`--apply` appends. Refresh the Slack corpus first: an ask it does not hold is simply not found.

- **Teams are GitHub's own, read live.** A closed pull request has no pending code-owner request, so a
  backfilled row's `codeOwnerTeams` is GitHub's whole answer: approved teams from each review's `onBehalfOf`,
  plus any request still open. That is the team GitHub applied to the change, which is what team history
  asks. One read per pull request carrying an ask the register does not hold.
- **A failed read writes none of that pull request's asks.** The register keeps the first writer of an ask, so a
  row with missing teams could never be corrected. The rest are written, the verb exits 1 naming each one, and
  a rerun reads only what is still owed. A pull request whose code owners overflow the query's fixed page is
  **held back** instead, never written and never a failure, since a rerun reads the same page (`heldBack`).
- **No marker field.** A backfilled row has the same shape as any other, because a seat running an older build
  reads the same strict register. Its `recordedAtIso`, long after its `atIso`, is what tells it apart.

## The page

`site/components/live/PullRequests.tsx` reads `reviewers` (`github reviewer list --json`, fast lane) beside the
landing reading. Each card carries who it is on the hook with and its suggested reviewer; the one state selector
(`site/lib/prViews.ts`) narrows to Waiting on review, code owner or platform off the verb's own act and wait,
never a field of its own. The Approve button is the `reviewer-approve` act (`site/lib/actVerbs.ts`), off on a
fixture. The console takes no typed words, so a decline is said in the call's chat with the card open and recorded
by a session with `github reviewer pick --verdict decline --feedback "<the owner's reason>"`.
When the two verbs name different readings, the page says so rather than drawing a suggestion beside a row it was
not computed from.
