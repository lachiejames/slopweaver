# The voice gates on the `--as me` lane

Bundled reference for the `slack` skill, split out of [as-me-lane.md](as-me-lane.md) when that file reached
its cap. Two gates read the words before anything is sent — one about VOCABULARY, one about SHAPE — and both
refuse rather than rewrite, under one named break-glass. The values they enforce are the operator's private
`profile.json` content, so this doc names the mechanism and never a rule's value.

## Nothing the owner would not have typed personally

Under the owner's name the message is **entirely** the owner's voice: no label, no caption, no footer, no "posted
by", no measurement stamp, no provenance line. The bot lane may carry meta because its reader knows a machine wrote
it; under the owner's avatar a caption in the bot's register is the owner appearing to write in a voice that is not
the owner's, to colleagues who cannot tell the difference. Shown four as-me probes, the owner approved the rendering
and struck the framing: alt-looking text is a voice rules violation, and the owner's voice matters most when
posting as the owner. Provenance that must be said goes on the bot lane or nowhere — which is why
`SlackPlainMessagePayload` (`src/outbound/slack/types.ts`) has no `blocks`, and why its one optional
`metadata` field is filled only by a bot NOTICE (`src/outbound/slack/noticeMetadata.ts`), never by an as-me
renderer.

## Generated text is proven by a live render, never by the unit suite

Code that GENERATES prose for a voice-gated surface — a briefing card, a PR body, a Slack card — cannot be
proven by any test in this repository, because the rules below are private `profile.json` content the schema
and the unit suite never see (`briefingFormSchema` says so in its own header). MEASURED: every unit
test passed and the schema accepted every card, and the first `slopweaver briefing render` over the owner's 34 real
open pull requests refused five on the literal em-dash rule. The generator was quoting another module's act
sentences, and a sentence carried onto a gated surface inherits that surface's rules. The same run found two
more defects only real data shows: a provenance note read as prose on 20 of 34 cards, and a whole-card word
budget that bit only once real titles were in it. Budget for the live render finding things.

## The vocabulary and spacing gates, and the verb that prints them

**Exact voice rules:** private `profile.json` content may declare `slackMe.voice.exact` entries with
`kind: "literal"`, `kind: "word"`, or `kind: "phrase"`. Literal matches are case-sensitive; word and phrase
matches are case-insensitive, and word matches require lexical boundaries. The gate inspects authored prose
from both `--form` and `--body` before mention resolution or any network call. It skips typed links, code,
mentions, broadcasts, quoted lines, URLs, fenced/inline code, and technical identifiers.

**The same rules refuse at every place words become the owner's, not only at the send door.** `slack draft record
--as me` parks NOTHING over a broken rule (`recordableVoice`, `src/cli/commands/slack/draftRecordMessage.ts`): a
parked draft is a Queue card the owner reads as the owner's own words, so leaving the rule for the send door left it
for the owner's eye. The talk console asks `slack voice-rules --check-stdin` of the whole message the voice offers,
its fold included, before it goes on the owner's running list, and puts nothing there on a refusal or on no answer
(`site/lib/copyVoiceCheck.ts`); the check has no hatch, since the owner is the one who pastes it. An em dash slipping into an offer is the
failure it closes. An offer with
`destination: "slack"` adds `--slack-draft`, holding it to the parked-draft shape too
([earns its place](earns-its-place.md)), so a paragraph that asks ends on its ask, and refusing any one paragraph
past 70 words, which those whole-message caps never see (a dense block needs more vertical
white space; `src/outbound/voice/copyVerdict.ts`). A relayed reaction to a running
list message carries it onto the board row in a marked
`relay-offer` block (`src/talk/relayOfferRow.ts`): the block is the exact text the owner was shown, the owner's quoted
heard words beside it are the authority on whether the owner approved, rejected or amended it, and the chair never reads a verdict out
of the block.

**Run `slopweaver slack voice-rules` before drafting anything on this lane — not after a refusal.** The
rules are the operator's own private content, so this doc names the mechanism and never the values; the
verb reads the same `profile.json` the gates enforce and prints every current literal/word/phrase rule
verbatim, plus the paragraph-spacing rule when it is on (`--json` for a machine-readable form). Skipping this step is what makes the gate feel routine
instead of rare: measured over a friction review, the literal em-dash rule alone tripped 4
composes in one window and 7 across five days, purely because nothing surfaced it before the draft did.

### The briefing receipt

**Reading the brief is enforced, not advised.** The owner ruled a drafting model missing their voice rules a P0, the
same class as an agent missing their profile, after a Queue card's reply was drafted with no brief in the prompt.
So `slack voice-rules` (not `--check-stdin` or `--json`) writes a receipt for the visible session it ran in:
`$SLOPWEAVER_HOME/sessions/voice-brief-receipts/<hash of the session>.json`, mode 0600, holding a digest of the
rendered brief and never a word of it. Every verb taking NEW words in the owner's name reads it first:
`slack draft record --as me`, `slack draft revise`, `slack post|reply --as me`, `slack edit --as me` and
`slack correct --as me`. A session with no receipt for the CURRENT brief is refused before stdin, a token or
Slack, the refusal prints the whole brief, and the receipt is written then, so redrafting from that brief and
re-running the same command is the whole recovery. A changed profile changes the digest and re-briefs every
session. `slack draft restore` and a `--draft` release are not asked: their bytes were admitted when recorded. A
release carrying `--thanks-instead` IS asked, since that line is new. `slack draft compare` is not: Codex composes
its candidate with the brief in its own prompt (`src/codex/slackDraft.ts`), and the session writes no words.

Three admissions are deliberate: no voice configured, no visible session (a process with neither
`CLAUDE_CODE_SESSION_ID` nor `CODEX_THREAD_ID` is not a model seat, rule 2), and the journalled `voice-briefing`
hatch (the owner supplied the exact final words). Both ids set at once is refused, since no single session can
be named. **The residue, stated**: a receipt proves the brief reached the session's context, not that every line
was heeded; and a model can still compose a first body before it calls the verb. Only that body parking or
sending is stopped. Slack is the one provider covered; Gmail, GitHub and Linear writes as the owner are not.
Code: `src/outbound/voice/briefingAdmission.ts`, the pure verdict in `briefReceipt.ts`.

**The verb prints TWO kinds of thing and labels each, because only one of them is a gate.** Above the rules
it prints the operator's RESPONSE SHAPE — how a reply should read: the length ceiling and what it does and
does not govern, what to lead with, whether a multi-claim message drips or lands as one, how a hedge is
meant to work. That block is ADVISORY. Nothing on this lane refuses on it, and it is there because the enforced rules are
a vocabulary while this is the shape, and a composer given only the vocabulary writes off-voice prose that
passes every gate. It is the body of the memory `slackMe.voice.shapeMemoryFile` points at — one
authoritative text in the operator's own memory corpus, never a copy in this repository, so the briefing and
the memory cannot drift.

**Quote the line you answer only when they said more than one thing**: the quote earns
its place by picking which point you answer, so a reply to a single-point message opens on the answer. It is
guidance here, because no Slack verb knows WHICH message a reply answers — `slack draft record` is top-level
and `--thread-ts` names a thread, not a message. Where the answered message IS known it is a gate:
`gmail draft --reply-to` refuses a draft opening on a quote of the whole parent
(`src/outbound/voice/redundantOpeningQuote.ts`, hatch `redundant-quote`).

**The pointer exists because** three skills promised "the operator's full voice guidance" and this verb
answered with a word list, so the promise resolved to a fraction of what it claimed while the shape itself sat in
an archived repository no code path read.

**A configured shape file that is missing, unreadable or not a valid memory EXITS 1 and prints nothing.**
That is deliberate and it is the opposite of degrading: a brief that quietly dropped the rules it could not
read would tell a composer this operator has no rules, and the send door would then refuse the draft on
rules it had been told did not exist. An installation that has configured NO shape says so in one line and
still prints its rules — that case is UNCONFIGURED, not broken. See
`src/outbound/voice/briefStore.ts`'s header.

This gate refuses rather than rewrites. For one deliberate exception, re-run after
`slopweaver hatch open voice-rules --reason "<why>"`; the original artifact then continues unchanged. Judgement calls such as
cadence, rhetorical patterns, or formatting complexity belong in the private rules document and cannot be
put in this exact matcher.

**The paragraph-spacing rule:** private `profile.json` may set `slackMe.voice.paragraphSpacing`. When it is
on, a SINGLE as-me message — a `one-card` post, a one-message `--body`, an `edit` — is REFUSED if two of its
paragraphs touch with no blank line between them. The owner types this way in one card in the owner's voice:
"a sentence.", blank line, "the next idea", blank line, "E.g. …" — one idea per paragraph, the `E.g.` on its
own line. The gate reads the FINAL RENDERED text, which is the only place a form's structural breaks and a
`--body`'s own bytes become the same string; a run of list items, a run of `>` quoted lines and a fenced code
block are one paragraph and are exempt. **A quote and its answer are ONE block**, and the gate cuts both ways
on it: `> their line` with the answer on the very next line passes, and a blank line pushed between the quote
and its answer is refused (a thread reply this gate had forced into the
gapped shape had to be fixed by hand, since the owner's voice does not write it that way). The blank line still goes between one
quote-and-answer and the next idea. A MULTI-message drip is out of scope by construction — the gap
between messages is its spacing. Same override, same refuse-never-rewrite contract. See
`src/outbound/voice/paragraphSpacing.ts`.

Neither as-me FORM can trip it, and this gate is what keeps that honest: `one-card` spaces its `lines` for
you and `one-list` spaces its `lead` from its `bullets` (whose items are an exempt run anyway). Only a
`--body` needs the empty line typed. A message that will not fit the form you picked means you picked the
wrong form — a roster or batch ask is `one-list` ([the-list-form.md](the-list-form.md)), never the override.

**The BOT lane is gated too, above the fold only.** A card's `tldr` and each `index` line go through the same
exact rules plus the packing rules — no colon-introduced list, no semicolon-joined clauses, one parenthetical
aside, no sentence over 30 words. `detail` is never scanned, which is deliberate: a quoted third-party title
carrying an em dash is correct input, and below the fold is where a quote belongs. Same override.
