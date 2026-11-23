# Plain words and the queue link

A floating note on the owner's screen must be very clear: the owner never digs for details or chases a wild goose
(a note reading "give the console voice a steer on a call that opened with a context pack" fails that), and it
links directly to the queue item to react to. Two posting refusals carry that, both outside `buildHandStep` so rows
already in the register stay readable (`src/hand/step.ts`).

**`FLEET_WORD`** — `fleetWordInWhat` refuses a `--what` holding any glossary variant listed in that entry's
`notOwners` (`src/talk/glossary.ts`), naming the word and what it means. The list is the voice's own, so a word
the voice explains is a word a note may not lean on. It is deliberately short: a variant with an ordinary
English sense (`door`, `grant`, `row`, `gold`) is never listed, because a bare match would refuse "Grant the app
access". It catches a fleet word in the glossary, never jargon the glossary lacks, so writing plainly is still
yours; adding the word to `notOwners` is how a new one becomes refusable.

**The queue link** — `reactionWithoutQueueLink` fires on a step asking the owner to react, matched as a phrase:
"react to", "decide", "pick" plus a chooser's determiner ("pick one", "pick the"), "steer" plus an object, or
"give … a steer". It refuses two shapes: a `--url` to the console's queue page that opens no item (the owner lands
on the list and hunts), and no `--url` at all when the sentence names the `queue`. Only that word, because five
review passes showed every noun a queue item is made of — an option, a card, a question, a reviewer — is also
what a phone approval, a macOS prompt or a payment sheet asks the owner to pick. The residue is a false PASS: "pick one
of the three reviewers" with no `--url` posts, and the link the minting side puts on every note carries it. A try-this note for a queue feature is still a reaction when it says "pick a card", so it links its own item (`open=hand%3A<id>`), which lands the owner on the queue page all the same — a note deep-links to its queue item. A reaction linking to the page the owner acts on — the Alignment page, a pull
request, a provider's settings — keeps that link; a step that is no reaction may link to the queue list itself;
a sign-in sentence and a `--literal` paste step are never reactions. Phrases rather than bare words because
five review passes each found an ordinary sentence the bare words refused ("pick up your YubiKey", "Log into
Google Cloud and pick your account", "the React error overlay", "say a quick steer"); a false pass costs one
step its link, a false refusal costs a session a step the owner really has to take. Replaying all 61 steps ever
posted, this refuses none — the three that asked a queue reaction already opened their item. The plain-words rule refuses
two, both naming a word the owner asked the meaning of (`context pack`, `JumpCloud atlas`).

**The proof link** — a note on an incident row opened the Queue list and left the owner a CI run as
evidence, when the rule is to lead with the proof, not with the PR. Two rules
(`src/hand/proofLink.ts`), both before the plain-words ones. `incidentWithoutProof`: a step whose `--row` starts
`incident-` opens its proof — a published page's viewer address (`slopweaver page publish`, then
`/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html`) or an https Datadog view — and is refused on no `--url`, any Queue
address (list or item), a CI run, a pull request or anything else; a sign-in or paste on that row is exempt.
`approvalWithoutPage`: "approve" then at most three words then a fleet noun (PR, pull request, fix, post, draft,
change, merge, deploy, release, plan, ticket, reply, message) is refused on no `--url`, a console list (the Queue
with no item, the board, the root) or a CI run; a page, a pull request or one Queue item passes. "Approve the push on
your phone", "approve of", "approved" and "post-mortem" never match, and a step naming its device (a dialog, phone,
macOS, System Settings, keychain, Touch ID, Duo, a passkey) is exempt. Replayed over the 412 steps posted at the time,
each refuses exactly that note. An incident card's `decision` may sit beside its proof (`misplacedDecision`).

**The decision** — `decisionWithoutAsk` fires on "decide" or an explicit alternative ("whether … or", "either …
or", or ", or" followed by an action — one opening on a subject or a modal verb names a consequence, "…, or the
window might close"), never on a `--literal` paste nor a sign-in that does not say "decide", and refuses three
shapes: no `--url`, a queue link opening no item, and a `hand:` item. The phrase test is a heuristic with misses,
so the refusal names the rephrase that clears a false one. A hand step's own card carries only its own fields, so a
decision opening itself draws no options at all — the note's done, hide and leave were options the owner could
not read.
Narrower than the reaction phrases because "pick" is how a phone approval reads. Replayed over the 68 steps ever
posted it refuses none: all 7 decisions already opened a shaped ask, and the defect there was the card, which
`site/lib/handStepAsk.ts`'s `linkedHandDecision` builds from that ask. `hand post` checks the link's SHAPE and
never reads the board — the queue's join is where an unshaped or missing ask shows, as the plain step card.

**The embedded decision** — a step may instead carry its choice whole, as a typed `decision` (problem, two to four
options each with its trade-off, lean, and all three stakes), decoded with the ask shape's own readers and caps
and refused when partial (`src/hand/decisionContext.ts`). `decisionWithoutAsk` passes a decision that carries one;
`misplacedDecision` refuses one on a sentence asking for no choice, or beside a link to another record, since two
contexts on one card leave the owner to work out which one is being answered. It is for a monitor's choice that has no other
record, where a board ask minted for it would read as the owner's own ask and need its own settling — never a stopped job,
which is a seat's to repair and never the owner's to decide (the owner's ruling; `src/monitor/card.ts` refuses a
card offering restart, repair or retire). A card's own link, `/queue?open=hand:<id>` with no `#` on whatever
console base the install configured, is not another record.
A monitor card checks the link it mints opens itself, and a base carrying a query or fragment refuses the card by
name (`src/monitor/card.ts`) rather than record a link opening nothing.

**The bare go-ahead** — `bareGoAhead` fires on "say the word / yes / go", "give (me) the go-ahead", "ok(ay) to",
"want me to", "would you like me to", "are you happy / ok for me to", "is it ok if", "mind if I", "should I / we",
"can / may / shall I / we" (never before have, get, see or
borrow — "can I have the code from your phone" is the owner's step) or "confirm you want" (`goAheadPhrase`,
`src/hand/decision.ts`), and passes only a
step carrying something to weigh: a `decision`, a non-empty `--cites`, a `--url` to the record that is not the
step's own card, or an `sd-` draft named in `--what`, `--where`, `--unblocks` or `--witness`. A `--literal` is
not one. "Say the word if you want the stale store-backup lease cleared" opens nothing, and
clearing a lease on the owner's machine is an obvious act — so do it and `slopweaver autonomy record` it. A go-ahead
carrying its `decision` is not `misplacedDecision`'s "asks for no choice". Residue: a paraphrase outside the list
posts, a `--cites` or `--url` exempts on presence, and only `hand post` checks a named draft exists. Replayed over
the 130 steps posted at the time: 7 match, none falsely.

**A sign-in's address is checked for PRESENCE**, not shape: its page as `--url`, or a `--literal` with `--where`.
Two complete sign-ins name a provider root that redirects to login, and `codex login` or `op account add` open no
browser, so a homepage or "a browser opens" pattern would refuse real steps. That it is the right page is yours to
have checked.

**Every surface draws the reason**: the console card and the floating note both draw `--no-address`'s reason (the
console says a legacy step gave none). A self-linked monitor card has no board row to bring a decision, and the
console and the posting gate read that self-link by one rule (`site/lib/queueLink.ts` restates `opensOwnHandStep`), on any configured console base,
remote or path-prefixed.

**The address** — `addressRefusal` wants every new step to say where it happens: a `--url` (or `--open`), a
`--literal`, or `--no-address "<why>"` (120 characters), which the queue card draws as its own `no address` row
and the register keeps as `unaddressed`. A reason beside an address is refused, since the record would contradict
itself. A `--literal` with no `--url` names its `--where`: a paste is payload, not a place. A sign-in (`isSignIn`)
needs its page as `--url`, or a `--literal` with `--where`; `--no-address` never excuses one: a sign-in with no link must tell the owner exactly the right place to go. A row posted before the rule still reads, and its card says the address
was never stated rather than drawing nothing. Residue: `isSignIn` is broad (`auth`), so a phone-approval sign-in
needs a page too. Replayed over the 128 steps posted at the time: 48 said
nowhere, 27 of them monitor cards, which link their own queue card; every sign-in already had its page.

A queue link (`src/hand/queueLink.ts`) is
`http://localhost:<port>/queue?open=<kind>:<id>` (or any spelling of this machine — `localhost.`, `[::1]`, any `127.x.x.x` — or `/queue/`) with the colon raw or `%3A`, the kind one of `hand`, `ask`,
`draft`, `post`, `pr`, `act`, an optional `context=slopweaver|work` in either order, and no fragment. Every
hand step is itself a queue item, so `hand%3A<id>` always exists; the ask or pull request the owner is reacting to is
better. `choose` (a sign-in's account picker), `answer` and a bare `approve` are left out on purpose; approving
fleet work is the proof link's rule above. Reproduce both ends:

```bash
slopweaver hand post --standalone --blocks --id steer-note --what "Give the voice a steer on the context pack" --unblocks y --witness z --quiet --home "$(mktemp -d)"
SLOPWEAVER_ALLOW_UNSEEN_HAND_URL=1 slopweaver hand post --standalone --blocks --id pick-note --what "Pick a reviewer, so the fix can land" --url "http://localhost:3000/queue?open=hand%3Apick-note" --unblocks y --witness z --quiet --home "$(mktemp -d)"
```
