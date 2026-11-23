# Choosing a shape, and posting it

Bundled reference for the `loop-bot` skill. Loaded when the body links here, not on every turn.

## The core deliverable comes first, and the door checks two of them

**Name the artifacts the question asks to be HANDED before you investigate, and get those into the answer
first.** A miss there is the whole answer failing, however correct the rest of it is — measured:
a deploy + 7-day-backtest + screenshots ask ran six review rounds over two hours and shipped with the monitor
ids and the screenshots but no clickable link to either monitor, so the owner could not open the thing the
ask existed for. Meanwhile it had self-assigned a gate evaluation, a before/after comparison and an
inconclusive characterisation nobody asked for, and every one of those six rounds rigorously verified THAT.

Two rules come out of it, and neither lowers the bar on what you do deliver:

- **Do not self-assign scope.** Deeper analysis you discover on the way is worth keeping and goes in
  CONCISELY, below the fold. It never displaces the requested artifacts and never becomes what the answer is
  about. The reviewer is told the same thing from the other side: unrequested scope is not grounds for
  `broken` or `incomplete`, so it cannot buy you another round either.
- **A `[n]` citation chip is not a deliverable.** It is provenance attached to a claim. A thing the reader
  opens is a `link` run with a label you chose — put it in `index`, above the fold.

**Six refusals decide what an answer owes**, and they are all `turn answer`'s rather than a reviewer's: two artifact
classes the question alone demands; that every ticket and control id is a hyperlink, that
a control is cited in the SAME item that names it, and that three or more distinct references asks which one a
picture would show better; and that a count, a proportion or a percentage names the command that measured it. Read
[links-citations-and-shots.md](links-citations-and-shots.md) before composing an answer that names more than one
ticket, control or pull request, or asserts a figure — it carries all six, each break-glass, and the one hole in the
link rule. Your own `turn resume --dispatch <id>` prints the deliverables list for the ask you were dispatched
for, so read it there rather than from memory.

## Compose to the size caps — they are printed, so never guess at them

`turn resume --dispatch <id>` prints an **OUTBOUND SIZE CAPS** block before its numbered steps, and the
routing brief prints the same one. Read it there. Every figure comes from the constant that enforces it
(`src/outbound/assistant/capGuidance.ts` builds the block from `contentLimits.ts`), so the printed budget
cannot drift from the door — and this reference deliberately does not restate a single number, because a
copy here could.

Three things about how those caps behave, which the numbers alone do not tell you:

- **Over a cap is a REFUSAL, never a silent trim.** The form is rejected at `turn resume --answer`, naming what
  it measured against which limit (`17 body blocks against the BODY_MAX_BLOCKS limit of 12`), so a correction is
  one edit. Never reach for the `truncated-send` hatch: a truncated answer is worse than being made to shorten one.
- **The `index` is wide on purpose** — `lead` plus `index` runs to ten lines, `indexStyle: "ordered"` ranks it.
- **A table is the cheap way to carry a long list.** Table cells cost body blocks and rows but contribute
  ZERO to the prose cap; paragraphs and bullets are what that cap counts, link labels included.

Measured on the real-world tagging dogfood, two of the first three real questions died at
validate time on a cap nothing had told the composer about — one worker recovered only by grepping the
constant out of `answerForm.ts` mid-turn, in front of a public channel. That is why the budget is printed,
and why reading it before you draft costs nothing.

## When the proof is a picture, attach the picture

**Measured: 10 answers posted in one day, 0 carrying an image, 8 of them linking a surface whose
whole content IS a rendered picture.** So an answer resting on a curve's shape, a dashboard's state, a board
or a diff attaches the shot in `images` by DEFAULT; your `turn resume --dispatch <id>` pre-flight prints that rule.
The judgement is yours, save a Datadog graph finding's three shots ([rule 7](links-citations-and-shots.md)).
**Read [visual-evidence.md](visual-evidence.md)** for the edges and what may capture a shot. A **user-facing impact**
ask leads with the customer's own replay frame of the error they saw: [user-facing-impact.md](user-facing-impact.md).

## Tag whoever the answer is for — attribution is not notification

**An answer that mentions nobody notifies nobody, however right it is.** Measured: a colleague's
question was answered 4h56m later in a card carrying zero mention runs, and the next bot card in the thread
told the owner it was "up in this thread, as its own reply attributed to them". It was — to the ask's
`messageTs`, in the ledger. Nothing in Slack ever told the person their question had been answered, and the
owner's stated ideal for that thread was the answer TAGGING the colleague who asked.

So `turn answer` REFUSES a channel answer that never mentions its asker (`src/admit/askerTagGate.ts`,
break-glass `answer.tag-asker:v1`). The edges, and none of them is yours to re-litigate at compose time:

| the ask                   | what the answer owes                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| a colleague, in a channel | a `mention` run resolving to them — put it in `index`, above the fold |
| the owner, in a channel   | nothing; tagging the owner for answering their own question is noise  |
| anyone, in a 1:1 DM       | nothing; Slack already notifies the only other participant            |

`{"type":"mention","person":"U…"}` is the run, and a raw Slack user id is a valid key — see the mention
rules below. Your `turn resume --dispatch <id>` pre-flight prints the exact run for your own ask.

**The one case the door cannot decide is yours.** When an instruction asks you to answer what somebody ELSE
raised, that person is the audience and gets the tag too — the door only knows who typed the message it
captured. A person named as the SUBJECT ("summarise what @a and @b shipped") is not its audience: no tag.
**A person the answer points to who is NOT in the thread is never tagged** — "ask Dennis", Dennis absent: say it
is waiting on Dennis to be added to this thread. Whether to ask the asker
to clarify, in-thread, is your own call.

## Choosing a reply shape

No route loads a corpus slice and there is no `grounding.kind: "corpus"` — routing is your own judgement,
never a keyword-matched filter (see `/slopweaver:loop`'s own header). One arm,
one honest `grounding`, filled in for however the answer was actually produced:

- **From context and judgement alone, no live source needed** → `grounding.kind: "conversation"`, with a
  `reason` naming why nothing live was required. No `images`.
- **A live investigation** — a command you ran, a log you queried, a dashboard you read — → `grounding.kind:
"verb"`, naming the exact capability you invoked (it must be one your own `RoutingDecision.needs` named —
  see below), with your own `evidence` naming what you read, and `images` carrying the already-produced
  screenshots or diagrams as absolute paths. This is the shape for a finding like _"a monitor nobody
  suspected had been silently dead"_ — the screenshot IS the verifiability where no corpus token is cited.
- **Nothing reachable could answer it** → `grounding.kind: "unreachable"`, naming the surface — it must be
  one `turn brief` listed as unavailable, or one your decision named as a need.

`grounding.kind` does not have to match the tier you judged — overrule it honestly (see the posting section
below) — but it must match what actually produced the answer and what your own decision named, because
`turn answer` checks both and refuses a mismatch rather than posting it.

**Compose and post are two steps, and keeping them apart is a hard rule rather than a style.**

- **Compose** produces a VALUE: the form. That is the step where judgement lives — what is true, what to
  lead with, what to cite.
- **Post** takes that value and sends it. Pure mechanism, no decisions left in it.

A step that both decides what to say and sends it cannot be handed to anything else, cannot be previewed
without sending, cannot be re-rendered after a fix, and cannot be tested at all: there is no form to hand
over, only a function that decides and fires in one breath. **Write the form to a file or a heredoc
first, then post that.** If you catch yourself composing inside the send, split it.

## Never hand-write Block Kit

**Fill the form. Always.** Do not imitate a previous message by writing blocks that look like it — a
subagent did exactly that, and the whole message had to be thrown away and re-rendered through the form.
Copying a rendered artifact is not a shortcut to it; it just produces something that resembles the output
while sharing none of its guarantees.

The layout and block structure are not yours to pick. Rules that hold regardless of which form a verb takes:

- **Every text field is plain text.** Markdown is inert inside Slack's `rich_text` — `*important*` renders
  literal asterisks. Emphasis is structural: `"bold": true` on a run.
- **Cite what you can**, with a `citation` run per `citations` entry — or a literal `[1]`, which the form converts
  into one. Never invent a number or a link. A citation no chip points at, a `[n]` naming none, and a `[n]` in the
  plain-string `lead` are REFUSED; labels are renumbered into reading order, so never hand-write a footer list.
- **Mentions resolve by exact match** — a person id, Slack id, Slack handle or email on a Slack identity;
  never a GitHub or Linear handle, and a key two people claim is dropped rather than guessed. Do not work
  around a refusal: mentioning the wrong colleague is worse than mentioning nobody.
- **A text run never carries a raw link or a raw mention.** A bare `https://…` in a text run renders as dead
  prose and a `<@U…>` shows the reader a user id — `rich_text` parses neither. Use a `link` run
  (`{"type":"link","label":"…","url":"…"}`) and a `mention` run. The form converts those two spellings at
  composition and the send door refuses anything still carrying one, so this is a rule you cannot quietly
  break — but writing it correctly keeps the label yours instead of the raw URL. A `<#C…>` is refused
  outright; name the channel in prose. A `<!subteam^S…>` converts into a `group` run. A URL in the
  `lead`/`tldr` is refused too: a plain string, so use `primaryLink`.
- **A PR or issue is `owner/repo#<n>`, never a bare `#<n>`.** The checkout never supplies the repo; the form
  resolves a bare number only when the answer already carries one full `github.com/<owner>/<repo>` link, and
  REFUSES it before posting otherwise (`botAnswerBareRefContext`; five wrong-repo links were measured).
- **A literal `@handle` typed into text is INERT.** `rich_text` leaves it as raw characters: it looks like a
  mention in the composer and in the transcript, pings nobody, and fires no listener. A mention must be a
  structural run — `{"type":"mention","person":"@handle"}` — which the dry run confirms by printing `<@U…>`
  and `mentions: 1 resolved`; `mentions: 0` means you wrote decoration. A whole TEAM is
  `{"type":"group","handle":"engineers"}`, by handle and never display name, REFUSED when disabled or empty.
- **A mention resolves the same wherever it sits — `index` or `body`.** Both regions are read for the people
  they name, so the ping fires either way and the choice is about what the reader sees first. A tag that
  says who the answer is for belongs in `index`, above the fold, so the card opens by addressing them.
  The `lead` is a plain string and holds no runs at all, so a mention cannot go there and one written as
  raw `<@U…>` is refused outright.
- **A DISPLAY NAME is not a key, and this is the mistake that looks like a missing roster entry.** A Slack
  identity is addressable by its `nativeId`, its `handle`, `@handle` and its email — never by the name Slack
  shows. So `@Some Bot` or `@some-bot` (the display name) fails while `@somebot` (the handle) or the raw
  `U…` id works. Before concluding somebody is absent, check which of the two you typed.
- **Bots are addressable by their Slack user id, and usually ONLY that.** `memberIdentityCandidates` excludes
  bots and deactivated members from the identity join, so a bot's member record — which does carry its
  handle — never reaches the roster; its identity is built from message authorship, which carries only
  `user: U…`. Measured on a real corpus: over half the people with a Slack identity carry no handle,
  and nearly all of those have a raw user id where their name should be. For those, the `U…` id is the only key.
- An override record in the store's identity roster (carrying a `source: "slack"` identity) can add
  keys, but reach for it only after ruling the two above out. **That roster is the install's own**, so a key
  that resolves for you will not on a fresh install — if you rely on one, say so rather than assuming it travels.

## Voice, and the boundary every turn states

- One answer per turn. Never split it across messages, and never follow it with a second message carrying a
  picture — images ride in the same answer via `images`.
- **When the proof is a picture, attach the picture.** A claim resting on a curve's shape, a dashboard's
  state, a board or a diff gets a screenshot in `images` by default, not a link the reader must leave Slack
  to open. A one-line factual answer needs none. **Never point a browser at Slack, GitHub, Linear or Notion** — those go through the door (rule 3). See
  [visual-evidence.md](visual-evidence.md).
- Concise. Lead with the outcome; the evidence trail goes below it, behind the fold.
- **No trailing question.** State the next step as a suggestion, declaratively. "Probably worth checking what
  went out last release" — not "want me to check the last release?". If they want it they will re-tag.
- **Never `--as me`.** The owner's voice is a different lane with a different token, and simulating it is the
  failure that lane exists to prevent. A channel finding is parked `--as bot` too ([detective](detective-datadog.md)).

### State what you could not prove, and never force a connection

Every turn ends with its boundary, in the answer itself and not only in the terminal: the `limitations` and
`warnings` from step 1, the corpus age if you did not refresh, the symptom you could not reproduce, the tool
the branch did not have, the source you could not reach.

**Never force a connection you cannot prove.** The tempting version is tying a finding — an alert, an error,
a metric spike — to an existing thread or ticket because the words look similar. If you cannot demonstrate
the link, post standalone and say what the candidate was and why you could not confirm it. A confidently
wrong association sends people to read the wrong context, which is worse than none. The same goes for
attributing work to a person, a release or a deploy.

**Three endings are all legitimate**, and picking the honest one is success: **answered**, with its boundary
stated; **could not determine**, after real tool use and not one empty retrieval, saying what you tried; and
**blocked** — a missing credential, an access you lack, an ask only the owner can settle — as one tight line
naming the single thing needed. Escalate EARLY; do not grind in circles and do not punt silently.
