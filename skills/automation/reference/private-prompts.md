# An automation's PROMPT is private, and the team channel only ever sees the card

A daily `investigate` row once fired and posted its own internal instructions (a line opening "FIRST run the verb
with `--json`") into a team channel, embarrassing the owner in public. The message was deleted and the row
disabled.

The defect was not the wording. An `investigate` row's `question` IS the bot's own briefing, and the row had
exactly ONE channel field doing two jobs: where the question is asked, and where the answer lands. Any row
pointed at a team channel leaks the briefing by construction, so no amount of careful question-writing fixes
it.

## The two fields, and which is which

| Field            | What it is                                                                           |
| ---------------- | ------------------------------------------------------------------------------------ |
| `params.channel` | Where the PROMPT is asked. Must equal `slackBot.promptChannel` — the owner's bot DM. |
| `params.postTo`  | Where the finished CARD goes. Also the owner's DM; absent means it stays put.        |

This is the same two-channel idiom `alert-summary` already uses (`channel` reads, `postTo` writes), so a row
author has one shape to learn rather than two.

**`postTo` is the owner's DM too**, the other half of this same incident: a
card nobody asked for goes to the owner's DM and the OWNER shares it, and a channel value is refused unless the row
carries the owner's recorded approval. Read [the-owners-dm-not-a-channel.md](the-owners-dm-not-a-channel.md) before writing either field.

The prompt message names where the card will land and marks itself as machinery, so the owner's DM does not fill with
unlabelled instruction blobs: it renders the question, then `The finished card goes in <postTo>, not here.`,
then an italic `automation · <recipeId>` line.

## Enforced by the SCHEMA, twice — schema, not review

**At plan time.** `planInvestigate` (`src/live/automation/investigate.ts`) refuses before anything is posted,
with `PROMPT_CHANNEL_PUBLIC`. The refusal names the row's own definition file and the exact edit, so a
session reading it does not have to work out what to change. It fails CLOSED: an install with no
`slackBot.promptChannel` configured refuses every investigate row rather than guessing at a private
conversation.

**At the wire.** The prompt is a declared outbound form — `automation-prompt`
(`src/outbound/artifact/automationPrompt.ts`) — so the door can SEE what a message is rather than
inferring it. `automationPromptChannelRefusal` (`src/outbound/slack/automationPromptChannel.ts`) refuses
that kind aimed anywhere but the prompt conversation, whatever the caller was. A future row shape, a hand
`slack post --as bot --form`, and a replayed argv all cross the same check.

**Neither refusal has an escape hatch, and both say so out loud.** An override here would be a documented
way to do the exact thing being refused, which is why the absence is named rather than left to read as an
oversight (the `hold` shape, `.claude/rules/error-handling.md`).

## The consequence that is easy to miss

A prompt in a DM changes the ask's SURFACE, and two live gates branch on it:
`admit/askerTagGate.ts` exempts a DM answer from tagging the asker, and `admit/documentDeliverableGate.ts`
skips the local-page-path finding there. `investigateBriefArgv` therefore DERIVES `--surface` from the
channel rather than passing a hardcoded `"channel"` — without that, every answer would be refused for failing
to tag the owner in the owner's own 1:1.

## Writing or auditing a row

```bash
slopweaver automation run-due --dry-run --recipe <id>   # the plan leg, with every effect withheld
```

A dry run prints the refusal for a row still pointed at a team channel, and the exact prompt preview for one
that is not. Audit the whole store by running it with no `--recipe`; only `kind: "investigate"` rows are
subject to this.

One bound to know before writing a question: the prompt caps at 500 visible characters, because the derived
message adds the destination and run-marker lines and the whole thing has to clear the no-fold bound. The
original ISO question was 583 and had to be trimmed.
