# The as-me render check, and the correction path

Bundled reference for the `slack` skill's as-me lane. Loaded when [as-me-lane.md](as-me-lane.md) links here.

## Why it runs twice

Formatting issues in the posting-as-me lane are a class of problem to fix. Two measured instances had
the same shape — something meant to be a mention or emphasis reached a reader as literal punctuation.
`@jonahy-acme` posted as plain text, and `*setTaskUrgency integration test:*` posted with its asterisks
showing. One pure checker (`src/outbound/slack/renderCheck.ts`) runs in both positions the question can be
asked, and each covers what the other cannot:

- **BEFORE the wire, on `--form`.** The door refuses a text run carrying a bare `@handle` or literal
  `*bold*`/`_italic_`/backticks. Inside a `rich_text` block mrkdwn is inert, so styling has to be a typed
  run (`"bold": true`) and a mention has to be a `mention` run. Nothing is published, so a refusal is free.
- **BEFORE the wire, on `--body`, for links only.** Whether `*x*` turns bold is Slack's call, but whether
  an angle-bracket link can parse at all is decided by the string: a `<url|label>` with another `<` or a
  newline before its closing `>` is refused, on a thread reply as much as a top-level post, and on
  `slack edit --as me` too. MEASURED: a bump as the owner
  went out with a link spliced inside another link's label, and Slack posted literal `<`/`>` around a URL
  that had swallowed the label. The well-formed `<url|title #N>` that `slack voice-rules` prescribes is
  untouched, and bare-reference linkifying leaves anything inside Slack's own `<…>` markup alone.
- **AFTER the wire, on everything.** Each sent message is read back and the report carries its permalink
  plus what Slack STORED. For everything else in `--body` this is the only check, because its styling and
  mentions are decided by Slack's own parse, which has not happened before the send.

The read-back **fails open**, always. The message is published by the time it runs, so a read that throws or
finds nothing prints `render NOT CHECKED (the read-back could not answer)` rather than claiming a failure.
Three states, not two: not checked, checked and clean, or published and wrong. Only the middle one is
reassuring, which is why silence is never used for it.

**A send that went out wrong is EDITED, never corrected underneath.** A bot appending its own correction adds
more clutter and looks ugly to humans.
Use `slack edit --as me` on the `ts` the send reported, or delete and repost. The permalink in the send
report is there so the message is one click away when it needs fixing.

## The pre-send proof, for the one lane the two positions above cannot cover

A raw `--body` post to a PUBLIC channel is the hole. It is a bare string, Slack decides its styling and
mentions at parse time, and that parse does not happen until it is already public. So for that case only,
the identical bytes go to `slackMe.renderProofChannel` first, come back through the same check, and are
deleted. A hit refuses the real send.

- **The venue is CONFIG, never a constant.** A workspace conversation id is per-install state: a constant
  here would be wrong for every other install (tools in the codebase, state outside it). Set
  `slackMe.renderProofChannel` in
  `profile.json` to a conversation you own — the bot's own DM is the intended one.
- **Every failure arm REFUSES and names its key**: block by default, say
  what was blocked and why, and name the hatch that re-runs past it. Nothing configured, a round trip
  that could not complete, and a proof that came back dirty all refuse, all naming
  `slopweaver hatch open unproven-render --reason "<why>"`. Failing closed with no key is the hard block this forbids.
- **The fail-open reasoning of the read-back does NOT transfer here**, and that difference is why these are
  two mechanisms. There the message is already published, so a lost check can only mislead about something
  that is out. Here nothing is published, so a lost proof means the send was never checked at all.
- **The DELETE alone cannot fail the send.** By then the question is answered, so refusing over a stray
  message in your own DM would block a send whose render is proven good. It logs loudly and names the
  message to remove instead.

A typed form never pays for this: it is already checked before the wire. Nor does a thread, a DM or a
private channel. **Nor does `--dry-run`** — it is the one gate that opts out of running under one, because a
dry run posts nothing and is documented as traceless, while proving a render means posting a real message and
deleting it. So this refusal is met on the real send rather than on the preview, which is the right way
round.

## What it does not catch

It reads structure, not meaning. A mention that resolved to the WRONG person is a resolved mention and looks
perfect here, which is what the roster's exact-match rule is for. A link whose label is misleading is a link.
And an emphasis marker inside a `code` span or a preformatted block is literal BY REQUEST, so both are
skipped deliberately rather than by oversight.

## How a bare `#<n>` resolves, and why an untouched one can start refusing

Every door resolves a bare reference through `src/outbound/linkify/bareRefs.ts`, and a briefing page feeds it
the context `src/briefing/bareRef.ts` builds from the WHOLE page. Two tests decide it:

- **Sole repo.** A bare `#<n>` resolves only when the body or page links exactly ONE GitHub repo; two is an
  ambiguity it refuses rather than guesses. So the check is page-global, not section-local: a section that
  passes alone can refuse once spliced beside one linking a second repo, and every OTHER section's bare refs
  refuse with it. MEASURED: a register section clean under `briefing check` alone refused ten
  untouched references in the live briefing. A publish that suddenly refuses a pile of references nobody
  edited means a second repo arrived — qualify them, and prove a section with `briefing render` over a page
  carrying a second repo, the real publish condition.
- **Magnitude.** A bare number with MORE digits than the largest one something checkable attests for that
  repo (every numbered `github.com/<o>/<r>/(pull|issues|discussions)/<n>` link the body already spells out,
  plus the PR being updated) does not resolve. MEASURED: a slopweaver PR body cited three five-digit
  `acme-admin` pull requests as bare refs, the sole-repo rule held, and the door linked all three into unrelated
  slopweaver objects. It is evidence-gated (a body attesting nothing refuses nothing) and one-directional (a
  small number on a large repo still resolves), so it is no substitute for reading what you wrote.

Write any cross-repo citation as `owner/repo#<n>`, which always resolves.

## Reading a preview, and `--json`

In the preview, `[b]…[/b]` / `[i]…[/i]` / `[c]…[/c]` mark styled spans, `<@U…>` a resolved mention, and
`[label](url)` a link. They are preview markers, not the message — a literal `*` you see is a literal `*`
Slack will show. `--json` gives a machine-readable document on stdout instead: the exact
`chat.postMessage` payload, the preview lines, every step, the warnings, how each mention resolved, and the
outcome (`sent`, or `refusal` when the door said no). Nothing else goes to stdout under `--json`.
