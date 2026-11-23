# The ONE-LIST form — a roster or batch ask under the owner's own name

`{"kind":"one-list"}` is the third `--as me` `--form` shape, beside `one-card` and `drip`
([as-me-lane.md](as-me-lane.md)). Three fields, and the split is why the form exists: a `one-card` `line`
is a paragraph and the renderer double-spaces every one of them, which is right for three ideas and a wall
for ten. `bullets` is the field Slack draws its own glyph in front of and renders single-spaced.

```json
{
  "kind": "one-list",
  "lead": [{ "type": "text", "text": "fresh batch of vuln fixes, one dep per PR. name's on each one" }],
  "bullets": [
    [
      { "type": "mention", "person": "jonah" },
      { "type": "text", "text": " " },
      { "type": "link", "url": "https://github.com/acme/repo/pull/<n>", "label": "#<n>" },
      { "type": "text", "text": " axios" }
    ]
  ],
  "trailing": [[{ "type": "text", "text": "278 alerts left, 3 critical" }]]
}
```

## Reach for it when a card would not fit, and never reach past it

**This is the form the finding that created it says was missed.** An approved ten-PR review
ask once went out only under the `voice-rules` hatch: the composing session knew `one-card` (whose
`maxLines` is 8) and `--body` (which the paragraph-spacing rule refuses when its lines touch), concluded the
door could not say what the owner had approved, and took the override. The list form already held that shape. **A
message that will not fit the form you picked means you picked the wrong form**, and the override is never
the answer to a shape problem.

## The bounds, and what each is sized on

- **`lead` is ONE line.** Three of the owner's own artifacts carry exactly one — a ten-PR message the owner SENT,
  the text the owner APPROVED, and the card the owner PICKED in the 20-example voice eval (example 14, where the
  owner chose Card A). Card A puts both clauses in the one line. The composer brief's "a batch ask is
  two lines, then the list" describes that content, not a second `lead` entry.
- **`slackMe.drip.maxBullets` (default 10)** is how many headline dot points one list may carry, and the default is
  the owner's security-channel post — ten items. It is a bound of its own rather than a share of `maxLines`
  because a roster's length is a property of the world it reports: ten open pull requests are ten dot points
  however short the lead is. **Eleven of them is a PROFILE change, never the voice-rules override**, and the
  refusal says so itself rather than leaving it here: both bounds carry their own route, because Zod's bare
  `Too big: expected array to have <=10 items` names none and a bound with no route is exactly what produced
  the override. Overflow a card and it names `{"kind":"one-list"}`; overflow the list and it names
  `slackMe.drip.maxBullets` in `profile.json`. Both end "never reach for the `voice-rules` hatch".
- **How many `trailing` lines** is the lane’s own `slackMe.drip.maxLines` (default 8), passed through by
  `src/cli/commands/slack/asMeForm.ts` rather than configured separately — `trailing` is where the total
  goes, and Card A closes on `278 alerts left, 3 critical`.
- **`slackMe.drip.cardVisibleMax` (default 1000) is the real bound**, lead, bullets and trailing added
  together, line breaks excluded. A caller cannot satisfy it by adding dot points.
- **No entry may contain a `\n`.** The fields are where the breaks go, so a smuggled one would be a line the
  structure does not know about and the preview would under-report the message's shape.

## What the renderer does for you, so you do not do it by hand

`src/outbound/slack/dripRender.ts` emits ONE `rich_text` block: the `lead` section with a trailing `\n\n`,
then Slack's own `rich_text_list`, then each trailing line as its own section with a LEADING `\n`. Both gaps
are measured (`render.ts`'s probe table, H3 and I2), not a second opinion about them.

Two consequences. **The paragraph-spacing voice rule passes by construction** — the blank line after the
lead is the renderer's, not yours, and a run of list items is exempt anyway
([voice-gates.md](voice-gates.md)). And **you never type a `•`**: the owner's own hand-typed message did,
because the owner was typing into the Slack client, and the form gives you the real list instead.

## Nested dot points

"Anything with groups in it is dot points, nested where a group has sub-items", so a list nests ONE level. An
optional `depths` array sits index for index beside `bullets`: `0` a headline, `1` a sub-point under the nearest
headline above it. `bullets` stays flat on purpose, so every gate that reads a dot point still reads every
sub-point. `maxBullets` counts headlines; the whole message's `cardVisibleMax` bounds the sub-points.

```json
{
  "kind": "one-list",
  "lead": [{ "type": "text", "text": "here's the split i'm thinking, is this what goes in each?" }],
  "bullets": [
    [{ "type": "text", "text": "Release notes page", "bold": true }],
    [{ "type": "text", "text": "draft it locally, then publish" }],
    [{ "type": "text", "text": "Search latency budget", "bold": true }]
  ],
  "depths": [0, 1, 0],
  "trailing": []
}
```

It renders as Slack's own nesting, a sub-point run as its own `rich_text_list` one `indent` in, and a voice
revision writes a sub-point as ` -` and reads an indented dot point back as one. The refusals: `depths` not one
for one with `bullets`, a list opening on a sub-point, and any depth past `1`.

## The bullet's own shape

Mentions, links, `code` spans and bare-ref linkification behave exactly as in the drip and card forms. Two
things worth knowing on a review ask specifically:

- **A scoped npm package is not a handle.** `@xmldom/xmldom` and `@clerk/clerk-react` both close one of the
  owner's own asks, and the render check leaves them alone (`src/outbound/slack/renderCheck.ts`). A bare `@jonah` in
  a text run is still refused before the wire — use a `mention` run.
- **One bullet may carry several links**, which is what Card A does for the person who owns six of the ten:
  one `mention`, then six `link` runs, then the labels. That is the shape the owner picked over one bullet each.

## Where the ask goes

**An ask goes to the channel that owns it and tags the person, never a DM out of nowhere** (it goes in the programme channel, not the DMs): an access
request to the team that grants it, tagging its people, a policy change to the programme's channel, a finding to a public channel tagging its
stakeholder, a group DM only where the owner named it. A review ask on the owner's pull request is the DM that stands: it goes to
its reviewer and carries "no rush" when there is none (voice eval example 15). **One pull
request is a sentence, never a dot point**: a batch that shrank to one drops the list. A person new to the conversation gets one line on the work the change follows, from its PR
body, before the ask. `slack draft record` of a DM review ask declares `--reviewer new|in-thread`, or `not-an-ask`
where the wording only reads as one, and the door refuses a one-bullet list, a comment-only change asking for a
review rather than a tick, and, for `new`, an ask that opens on the ask (`src/outbound/slack/reviewAskShape.ts`).
It holds the shape at recording and a direct post, never at the release of a draft the owner approved.

**Several asks to ONE person inside a day are one batch DM, never N boilerplate singles** (a fourth "could I grab a review … no rush" DM to the same
person in a day reads as less human). The batch opens self-aware
("actually can you just review all these lol"), then a dot point per pull request still waiting on them, the ones
already asked included, and "no rush" once. `slack draft record --act review-ask`, top-level in a 1:1 DM, refuses
an ask beside one already HELD for that person unless `--supersedes` names it, and a single (fewer than two linked
pull requests) beside one already RELEASED to them on the owner's Melbourne day; a `D…` id joins its `U…` member through
`conversations.info` (`src/outbound/slack/draftSamePersonDay.ts`). No hatch: the batch is always composable. A row
recorded without `--act review-ask`, and a direct `slack post`, are outside it.
A batch ask
is the channel post this form is for, and the people it is about are TAGGED rather than named in prose. Run
`slopweaver slack voice-rules` before drafting a word of it. This is WHERE an ask lands once it is sent, never WHETHER: one nobody asked for is parked with `slack draft record` for the owner's yes first (rule 10).
