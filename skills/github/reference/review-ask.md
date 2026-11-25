# What makes a message a review ask

Bundled reference for the `github` skill, split out of [review-state.md](review-state.md) because it is the
one answer that has to be _very_ accurate before any later phase of autonomy.

A message merely containing the link, or the link plus the word review, is NOT an ask. So
`src/review/askClassification.ts` certifies the constructions the owner actually writes, vetoes
the shapes that cannot be an ask whatever they say, and answers **`undecided`** for the rest. A confident
wrong answer on two pull requests is worse than an honest abstention on twenty.

MEASURED on the 46 distinct Slack messages linking the owner's 22 open `acme-admin` pull requests, hand-labelled in a
visible session: **45 of 46 exact, no false positive and no false negative**, the one divergence an
abstention. Per pull request, over the 21 the corpus reaches, **17 asked, 2 never asked, 2 undecided**. Reproduce the capture with
`slopweaver github landing --repo acme/acme-admin --author <login> --slack-live --json`.

**The ladder, in order, and a wrong answer names the rung that produced it.** A request or a negation is read
only from words the owner TYPED: mention, channel and user-group labels and link URLs are blanked first, so
`<#C…|code-review>` or `<!subteam^S…|@platform-codeowners>` never supplies the word; a link's own label
still does.

1. **Three vetoes** — the owner's own conversation with the owner's bot (**the whole conversation**, whoever posted:
   six of the owner's own messages there once read as asks, two of them verbatim DRAFTS of a message posted
   to a real channel minutes later); an app speaking as ITSELF; anybody else's message, which can never
   answer "did THE OWNER ask". The as-me lane needs no case — `src/corpus/slack/ownerBot.ts` resolves it to the owner at
   projection time.
2. **A struck-out request** — tested on the REQUEST, never on the link. The owner struck an ask out and wrote
   `EDIT: not yet`, then kept a long unstruck body linking the same pull request twice more.
3. **An explicit negation** — _"a product call rather than a code review"_, _"nothing has been sent"_.
4. **The counterpart's own reply** in a direct message answers an ask rather than making one.
5. **No request construction at all** — a non-ask, unless the owner addressed somebody, which is `undecided`.
6. **The link is not in the owner's own words** — reached through a quoted permalink, or through the ROOT of the
   thread it replies in. Slack's own unfurl is read ONE hop, and a quote decides before the thread: when the
   route names exactly this pull request, a standing addressed request is the ask; otherwise `undecided`.
   Two real asks of the owner's name the pull request only through a quote; `@Jasper please review this` under
   `<PR> is ready` names it only through its thread.
7. **An addressed request** — the ask.

**Recipients are scoped to the pull request, not to the message.** One link takes every tag; several links
take the tag on their own LINE, falling back to the tags on lines above the first link's line. One `#dev-alerts`
batch of the owner's names one reviewer per line, and the whole-message union sent two of its five open
rows chasing somebody never asked about them.

**A tag is a structural mention run**, `<@U…>` or `<!subteam^S…>` — a bare `@handle` pings nobody. One
inside a `cc` parenthetical copies somebody in rather than addressing them, and one struck through addresses
nobody at all.

**DISCOVERY still matches the whole raw payload; ATTRIBUTION reads only the owner's own words.** Slack's markup for
a labelled link is `<url|label>` and the projection keeps the LABEL, so roughly three in ten linking messages
carry the URL only in `raw`. Finding a message that way is right; attributing an attachment's words
to the quoting author is not.

**`undecided` answers `asked: unknown`, never `no`**, and names each unsettled permalink for a visible
session, which reads it and records the answer with `github reviewer read` ([reviewers.md](reviewers.md)); the
landing then answers that message by rule `visible-read`. MEASURED over the same live read, `main` vs this rule: the collapse to `no` alone moved
one pull request from waiting on its reviewer to `outside-the-set`; with it, every other dispatch verdict is unchanged.

**A certified `no` is a draft, never a send.** A pull request nobody was ever asked for dispatches
`draft-first-review-ask`: its seat drafts the FIRST ask to a named person and parks it for the owner's yes with
`slack draft record` ([dispatch.md](dispatch.md)) — only once it has linked the discussion that agreed the change, or
named the small obvious bug; otherwise it parks a discussion opener and no ask (lead with the discussion, not the pull
request: `slopweaver knowledge recall review ask reviewer --domain review`). Only `no` does — `unknown` is `unread`, never a draft.
On a team repository the fleet raises no fix pull request off its own finding at all: the finding goes to the owner, and
whether a fix follows is the owner's word ([why](../../../docs/doctrine-rationale/rule-10-team-facing.md)).
`slack draft record` refuses a teammate's draft whose first block opens on a pull request or asks for a fix review.
A certified `no` is the proof nobody was asked, so `github reviewer ask` records `--asked-before none` itself; a
chase of a released ask names it instead ([asked-before](../../slack/reference/asked-before.md)).

**An author is the owner only when both ids are present** — an unconfigured owner id and an authorless post
are not equal. A direct message with the owner's own bot is `owner-only` on the live leg too.

**The two legs merge on `channel:ts`, never on the permalink.** The live leg's permalink carries a
`?thread_ts=…` query string and the corpus leg's does not, so a permalink-keyed merge never collided:
one pull request reported two asks for one message and another nine for six, and the corpus copy — the only one that
can read `bot_profile` — never won the collision it was supposed to. A copy naming no author (a pin) never
replaces one that does, and the corpus copy's conversation always survives.

**A reply is read with its thread, and only its thread answers an ask.** The same second pass reads every
message in a thread holding a wanted link, because a reply rarely repeats it: MEASURED: one
ask carries four replies in bronze and none links it. A reply reaching no pull request — in its words, a quote
or a forward, across every COPY of it, matched by `channel:ts` so a reply also sent to the channel is one
message — joins the pull request as an `association: "thread"` mention (`src/review/reviewConversation.ts`),
and inherits it only from a root THE OWNER WROTE that reaches that one pull request alone. Under somebody else's
announcement the owner is a participant, not an asker: a reply promising approval once the author confirms a fix,
on THEIR pull request, certified as the owner's ask until a fallback review found it on two real threads.

**A message reaching its pull request INDIRECTLY has to ask in its own words**, because its pull request is implicit and the lexicon reads
a report exactly as well as a request. **Both indirect routes run the same gates** — a quote decides before a
thread, and running these on the thread alone left the quote route certifying _"this one is just waiting on
review"_, quoting the colleague's own chase, as an ask OF the owner. It must carry a request construction — `pls`, `can/could/would you`,
`any chance`, `mind taking`, `re-review`, `ready for your …`, `when you get a sec`, or a `bump`. **Neither
indirect route reads a line it QUOTES**, request and need alike: a colleague asking THE OWNER is not the owner asking them,
and the quote route certified exactly that. A message that reaches its pull request indirectly, addresses
somebody and asks in a form the LEXICON has no word for — _"Thanks <@…>, ready for round 2 :pray:"_ — abstains
rather than certifying a non-ask, which is what three real re-review asks of the owner's read as. A NEED it names (`tick(s)`,
`code-owner`, `approval`, `sign-off`, `blocked`, `waiting on`), in its words or the labels of the groups it
tags, withholds certification when the only marker is a bump: a reply reporting weeks of bumping that stays
blocked on a codeowner tick is what the owner has been doing, while _"mind taking this one … just needs your
codeowner pass"_ is what the owner wants.

MEASURED over the owner's whole Slack bronze, by a fallback review sweeping every linkless thread
reply of the owner's that sits under a single-pull-request root: **every reply this route certifies is really the
owner asking**, and the certified set is single figures. Before the report rule, five of those certifications were
the owner saying _"reviewed, left some Qs"_ or _"Reviewing now @Quinn!"_, each a card chasing a colleague for a review the owner had
just done. **The population depends on which pull requests you sweep, so a bare count is not a fact about this
rule** — three rounds reported three denominators for the same claim. Reproduce it by scanning
`$SLOPWEAVER_HOME/corpus/bronze/slack/*.jsonl` for the owner's replies spelled `channel:root:reply:ts` whose own text
links nothing, writing each one AND ITS ROOT into a throwaway home, and running `scanCorpusMentions` over it
with the pull requests you are sweeping as its `refs`, then `askDecisionFor` on each mention. Roots and refs
are both load-bearing: without the root a reply inherits nothing, and an empty `refs` answers an empty scan.
Over every pull request the bronze names, that sweep read a few hundred replies and certified under ten.

**An indirect direct message abstains rather than answering never-asked.** A direct message addresses its
counterpart with no tag, so a pull request reaching one through an unfurl, with no request this read knows, is
not evidence the owner did not ask: one casual handover line in a real DM, above a nine-pull-request
board answered a confident **never asked** on six of them. The cost is stated rather than hidden — dozens of real
messages of the owner's, _":thinking_face:"_ and _"Good catch, will fix the comment then merge"_ among them, move from
a correct certified non-ask to `undecided`, and 4 pull requests' `asked` move from `no` to `unknown`.

**Only the ask's own conversation ends its silence.** The tagged person speaking in the ask's OWN thread, or its
own direct message, is a reply; a later message elsewhere is not, however it is worded. **The ASK settles what
its thread is about** when the owner's own words link the pull request in it; where they do not, a reply under a root
naming several pull requests — or one whose copies disagree — reads `unknown` with its permalink. Demanding the
ROOT name it reported about three in ten verdicts `unknown` over the owner's corpus, every one a person who had really answered. Speaking ends a
silence; only a landed GitHub review completes one. **Not yet read**: a live-only ask's thread (search returns no
linkless reply), a linkless top-level follow-up in a direct message, and a group DM's audience.

**The newest copy of a message decides.** A second corpus pass reads every other copy of a candidate message,
including one that REMOVED the link. An `edited` copy beats an unedited one. Copies that still disagree have
no order, because hygiene rewrites the edit time, so that message reads `undecided` (`versions-disagree`).
MEASURED: over ten thousand distinct messages link an acme-admin pull request, and a handful have
disagreeing copies.

**A bare pull-request number is not discovered, on measurement.** The owner's whole Slack bronze holds 2 messages
the owner wrote that tag somebody beside a bare number with no link, and neither is a review ask. Re-measure by
streaming `$SLOPWEAVER_HOME/corpus/bronze/slack/*.jsonl` for records the owner authored whose `raw.text` tags someone, carries
`#?1NNNN`, and carries no `github.com/`.
