# A turn nobody tagged you in

`slopweaver witness help` opens an ask in a thread a person tagged the bot into earlier, on a later message
that did not tag it: 👀 on the message, the progress card, then the ordinary turn. Its brief carries
`unprompted: true`, and both `turn brief` and `turn resume` print an `UNPROMPTED` block straight under the
question (`src/live/turn/unpromptedGuidance.ts`). Everything after the card is the tag path, unchanged.

## Why it exists

A tag already investigates; in a thread it was tagged in earlier the bot is witnessing, and if a need arises
where it can effectively help in a way likely perceived positively by the user, it just does it — otherwise it
risks doing someone's work for them when they were specifically asked. The card is the proactive update the owner asked for: a person who reads "big problem, investigating now"
needs to see the bot is on it, or they duplicate the work.

## What changes in the turn

- **Open on what you looked into and what you found**, never "you asked". Nobody asked you.
- **Never do work a named person was asked to do.** "@seth can you fix the migration" is Seth's; answering it
  takes their task off them in public. A STATUS question a leader asked of someone else — "@payments-lead what
  is going on?" — is answerable: the owner named that case as one the bot should take.
- **Short, and only what is material.** An unprompted answer that is noise costs the next one its welcome.
- **The judge may still say `no-response`.** The card is up, so the turn finalises it like any other; a
  `no-response` on an unprompted ask is a correct read of a thread, not a failed one.

## The asker answering what the bot asked for

One unprompted message is not unprompted at all. The bot was asked to raise a pull request or a ticket, said
there was not enough to raise something good and named what was missing
([raising-a-pr.md](raising-a-pr.md#step-5--only-on-an-explicit-raise-a-pr-or-raise-a-ticket)), and the asker
replies with it without tagging the bot. The owner's ruling: pick
that up and create the ticket, which is like witnessing a thread being useful. So the loop runs `witness help` on it, subject to every refusal below, its daily cap
included, and the turn finishes the ORIGINAL ask: the asker did ask, so it raises what was asked for and opens on what it raised. If the reply still leaves the gap
open, the answer says what is still missing, once. The person's own earlier words are the ask, never the bot's
question: a ticket the bot proposed unasked is not one, and that reply is answered as any other.

## A correction of the bot's own answer

The bot answered; somebody replies, untagged, that it is wrong — _"that's wrong, we changed it to Melbourne"_.
The owner's ruling: the bot revises. So the loop runs
`witness help` on it, and the turn checks the correction against a source rather than taking it on trust. If
it holds, the revised answer names the old answer's `ts` in the form's `supersedes`, and with the reviewer's
warrant the old one comes down once the new one is up ([posting](posting.md#a-correction-deletes-the-answer-it-replaces--declared-by-you-warranted-by-the-reviewer)).
If it does not hold, say what the source shows, once. A correction of somebody ELSE's message is not this.

## What it is not

Not a peer-bot witness: a claim a configured peer bot made is checked by `witness dispatch`, which posts only a material
finding with proof ([the witness skill](../../witness/SKILL.md)). Not a reply to every message: `witness help`
refuses outside the bot's own threads, for a non-responder, on an ignored message or one already an ask,
while another ask is live in the thread, past `UNPROMPTED_HELP_DAILY_CAP` helps a thread a day, in a thread
somebody stood the bot down in (`witness stand-down`; only an explicit tag reaches it there), and unless
Slack's own read of the thread shows a responder — a person, never a peer bot — tagged it in first.
