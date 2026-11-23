# The `--as me` lane, verb by verb

Every verb that carries the owner's own lane with one runnable example each, the drip form, the shape
choice, media, the escape hatch, the voice gates, and what to do when a drip is only half sent. The rules —
freeform and drip-fed, never a card, and a bump must tag — are in [SKILL.md](../SKILL.md).

**Every verb that carries the `--as me` lane, with one runnable example each.** The rules behind each are
below and in the lifecycle section; this block exists so nobody has to infer the lane's shape from a usage
line again. `slack edit --as me --body` was real and shipped for a month while `slack edit --help` named
neither flag, and a session read that help twice and concluded the path did not exist.

```bash
# post — N short messages under your own name. --shape is REQUIRED and has no default.
slopweaver slack post --as me --channel C123 --shape top-level --body - --dry-run <<'MSG'
shipping the retry fix today, staging looked clean overnight
MSG

# reply — the same drip, into an existing thread. A reply takes no shape flag at all.
slopweaver slack reply --as me --channel C123 --thread-ts 1712345678.000100 --body - --dry-run <<'MSG'
yep — same root cause as the one last week
MSG

# edit — replace ONE message you posted, in place. --form takes a single-message drip; --body is raw.
slopweaver slack edit --as me --channel C123 --ts 1712345678.000100 --body - --dry-run <<'MSG'
fixed the broken link above ↑
MSG

# delete — remove one message you posted. No content flags at all.
slopweaver slack delete --as me --channel C123 --ts 1712345678.000100 --dry-run

# media — screenshots ride under the LAST message of the drip, uploaded on the USER token.
slopweaver slack post --as me --channel C123 --shape top-level --media before.png,after.png --body - --dry-run <<'MSG'
p99 before and after the pool change
MSG
```

Drop `--dry-run` to send. Every one of these goes through the door and previews first.

This lane has **three form shapes, and picking the wrong one is the commonest defect here.** A top-level
post to a PUBLIC channel is ONE message and the door refuses a drip there outright: a discussion piece is
ONE CARD (`kind: "one-card"`, below) and a roster or batch ask is ONE LIST (`kind: "one-list"`, its own
reference at [the-list-form.md](the-list-form.md)). A thread — a reply, or a parent with replies under it
— is **freeform and drip-fed**, because that is how the owner actually writes: one or two
concise sentences in the owner's voice per section. The drip form is a sequence of short messages, sent in order about 1.5s apart:

```json
{
  "kind": "drip",
  "messages": [
    { "runs": [{ "type": "text", "text": "One or two concise sentences." }] },
    { "runs": [{ "type": "text", "text": "The next thought, as its own message." }] }
  ]
}
```

Rules that are not yours to bend:

- **No internal line breaks.** A `\n` inside a message is REJECTED. The gap between messages IS the
  spacing — that is the whole point of the shape.
- **Each message stays a sentence or two**, bounded by `slackMe.drip.messageVisibleMax`. Absent a profile
  the code supplies 300 visible characters, which is a starting shape with no measured corpus behind it
  rather than a preference anyone expressed. Writing the value into `profile.json` is what makes it one.
- **A SOLE message is bounded differently, on purpose.** A one-message drip is a top-level announce rather
  than a conversational line, so `slackMe.drip.soleMessageVisibleMax` (default 1000) bounds it instead of
  `messageVisibleMax`. A proposal or discussion piece goes out as ONE message,
  because several leave a reader unsure which to reply to. `slopweaver proposal teaser` renders this shape.
- **No citations.** They are structurally absent from this lane.
- **Mentions work exactly as on the card** — `{"type":"mention","person":"<key>"}`, exact-match only.

## The render check, and the correction path

One pure checker refuses a defect a reader would see BEFORE the wire on `--form` (and a `<url|label>` that
cannot parse on `--body`), and reports what Slack stored AFTER it on every send, permalink included. A wrong
send is EDITED, never corrected underneath. The measurements and the fail-open contract:
[render-check.md](render-check.md).

## The ONE-CARD form — every top-level post to a public channel

A four-message drip plus its follow-up correction was once deleted from a public channel. Such posts go out as
one top-level card as the owner, similar to discussion pieces, since a post in a very public place often serves
as a discussion piece as well, and a discussion is much easier in one message.

```json
{
  "kind": "one-card",
  "lines": [
    {
      "runs": [
        { "type": "mention", "person": "jonah" },
        { "type": "text", "text": " pls review" }
      ]
    },
    { "runs": [{ "type": "text", "text": "One sentence on what it is." }] }
  ]
}
```

- **`lines` IS the line structure**, so a `\n` inside a run is refused — add another entry instead. This is
  not the drip's newline rule restated: the drip has nowhere to put a break, and this has somewhere better.
- **A line IS a paragraph, and the renderer puts a BLANK line between them.** A card needs more vertical
  spacing to be in the owner's voice, as a discussion piece arriving as one dense block showed. You write the lines; the spacing is not yours to choose,
  and `cardVisibleMax` excludes line breaks so nothing you wrote gets nearer the cap for it.
- **`slackMe.drip.cardVisibleMax` (default 1000) bounds the WHOLE card**, every line added together, not
  each line. Deliberately: a per-line cap is fragmenting pressure, which is the thing this form removes. The
  default is the same number `soleMessageVisibleMax` already carried for this same shape, not a new one.
- **`slackMe.drip.maxLines` (default 8)** stops an unbounded list. The real bound is the one above.
- Mentions, links, styling and bare-ref linkification behave exactly as in the drip form. That is the point
  of it being a form rather than `--body`: the escape hatch verifies no mentions and styles nothing.
- **Benchmark against the owner's SENT messages, not the owner's approved drafts.** The owner's own rewrite of an
  approved one-card draft was TWO LINES — mentions + "pls review" + the PR link with its full title, then one sentence
  on what it is — with the measurement, the explanation and the invite-to-push-back all cut. A single-PR
  review ask defaults to that shape, detail in the PR body; a person new to the conversation gets the work first ([where the ask goes](the-list-form.md#where-the-ask-goes)). A BATCH of them is not this form at
  all: it is `one-list` ([the-list-form.md](the-list-form.md)), whose `bullets` are sized on the owner's own
  ten-PR post. Widening `maxLines` to fit a roster into a card is the wrong fix.

**The door refuses a multi-message top-level drip into a public channel**, naming both compliant forms. It
fails CLOSED: if Slack cannot say whether the channel is public or private, the send is refused rather than
guessed at, because the case it would guess wrong is the public one. `slopweaver hatch open public-drip --reason "<why>"` is the
journalled break-glass for one deliberate exception. A PRIVATE channel, a DM, and any `--shape thread` send keep
the ordinary drip rules, and a single-message post never triggers the surface lookup at all. See
`src/outbound/slack/publicCardGate.ts`.

**A bump must tag the person, or the door refuses it** (a tagged person is more likely to see it). If the rendered text of a `post|reply --as me`
drip, or an `edit --as me`, reads as a chase — `bump`/`bumping`, `nudge`, `reminder`, `pls review`/`please
review`, `still waiting`, a review request — and carries no resolved `<@U…>` mention anywhere in it, the
door refuses before anything sends, naming who it thinks is being chased when it can tell from the prose.
This applies to `--form` and the `--body` escape hatch alike: a raw `<@U…>` you typed yourself in `--body`
counts, same as a resolved `{"type":"mention"}` run — see `src/outbound/slack/asMeBumpGate.ts`. The fix is
always the same: add a real mention, resolved through the roster above, never a display name.

**`--shape` is REQUIRED and has no default** for an as-me `post`, whether the words came from `--form` or
`--body`. For a MULTI-message drip the two values are materially different artifacts and the choice is the
owner's — some conversations are top-level by convention, others are thread-per-topic — so ask the owner.

For a **single** message there is nothing to ask about: `post` refuses `--thread-ts`, so message one has no
parent either way and both values produce the identical `chat.postMessage`. Pick one and send. The one thing
that is not free: shape is part of a message's duplicate-suppression identity, so if you later re-run or
extend that drip, **reuse the same value** — switching it makes the original look like a different send.

- `--shape top-level` — N separate messages in the channel. In a PUBLIC channel N must be 1: send the
  `one-card` form instead, which is one message however many lines it has.
- `--shape thread` — message 1 becomes the parent, the rest reply under it.
- `slack reply --as me --thread-ts <ts>` — every message replies into that thread (no `--shape`).

**Attaching evidence: `--media a.png,b.png`.** The files upload privately on the USER token and then land
under the text of the **last** message of the drip — the same message, not a follow-up, so the owner's words and
the screenshots that prove them travel together. Order is preserved exactly as you typed it. Every earlier
message of the drip carries nothing. The card lane's all-or-nothing rule applies: if the files cannot be
verified onto the message, it is DELETED and the drip reports as incomplete, never evidence-free prose under the owner's name.

Two consequences worth knowing. Slack marks that message **`(edited)`** — the files attach by editing the
message that was just posted, so the label is accurate and unavoidable; it is Slack's own chrome, not words
put in the owner's mouth. And the media paths are part of a message's duplicate identity,
so posting the words and then re-running the same words WITH screenshots does send again (with the files),
instead of being skipped as an already-sent message.

**The escape hatch:** `--body -` sends what the owner typed as ONE message — no sectioning, no width rule,
no newline rule, and Slack parses it as it parses anything the owner types by hand. Use it whenever the sectioned form
would be friction rather than help. It is exempt from the SHAPE rules, never from the VOICE rules: both the
exact vocabulary gate and the paragraph-spacing gate below read a `--body` exactly as they read a form.

Two qualifications. Reading from stdin removes one trailing **line feed** — a heredoc always adds one and
nobody means to end a message with a blank line — and everything else arrives byte for byte. Note the
precision: on a CRLF ending only the `\n` goes, so the `\r` is still in the message. And a plain body is still
bounded by Slack's own 40,000-character ceiling, which is a mechanical platform limit rather than a preference.

**The voice gates.** Two read the words before the wire: the exact vocabulary rules (`slackMe.voice.exact`)
and the paragraph-spacing rule (`slackMe.voice.paragraphSpacing`), refusing a SINGLE as-me message whose
paragraphs touch, or whose `>` quote has a blank line before its answer. Both cover `--form` and `--body`
alike, both refuse rather than rewrite, and the `voice-rules` hatch is the one deliberate exception.
**Run `slopweaver slack voice-rules` before drafting a word on this lane; it is enforced.** It prints the ADVISORY
response shape as well as those two rules, and writes the session's [receipt](voice-gates.md#the-briefing-receipt):
new words as the owner from a session holding none are refused with the brief printed. The mechanism, the
exemptions, the bot lane's own half and the measurements: [voice-gates.md](voice-gates.md).

**Where a draft for the owner's eyes goes — approval versus reaction — is [draft-review.md](draft-review.md).** A
draft awaiting the owner's approval to SEND renders in the owner's private bot DM as real messages, while a message to a person nobody asked for is PARKED on the owner's queue (`slack draft record`); one offered for the owner's
reaction inside a briefing lives inline in the card's fold; one the owner already said yes to is SENT, with the owner's typing
fixed here and never a second ask ([pre-approved](pre-approved.md)). None is ever a file path or a terminal preview.

```bash
slopweaver slack post --as me --channel <id> --shape top-level --form - --dry-run <<'JSON'
{ …the drip… }
JSON
```

### If a drip is only half sent

A drip is N sends behind ONE approval, so it can stop partway. The report always lists **every** message
and what happened to it. Re-running is safe: messages that landed are recorded with their `ts` and are
skipped, never reposted, and appending a new line sends only that line.

A line Slack itself **refused** (`ok: false`, e.g. `channel_not_found`) releases its own reservation, so a
plain re-run sends it. The one case needing a human: a message whose outcome is **unknown** (claimed, never
confirmed — a lost response). The run halts and refuses to guess, because skipping would silently drop a line
and resending would double-post. **Show the operator; ask them to look at the channel.** Only if they confirm
it is NOT there, re-run with `--resend-unconfirmed`.
