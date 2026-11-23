# Revising a parked draft's words: `slack draft revise | restore`

The fleet has every capability to edit a draft live. The owner opens
a Queue card, says what the owner does not like, and the console voice rewrites the draft in front of the owner. The
card then reads `v2 · v1 kept`, and "put it back" restores v1. Body only, Slack only, never a send.

```bash
slopweaver slack draft revise <sd-id> --text - --heard "<the owner's words>" --reading '["<what you change>"]' --anchor <a> < words.txt
slopweaver slack draft restore <sd-id> --version 1 --heard "<the owner's words>" --anchor <a>
```

The console voice reaches both through `/api/talk/draft` (`draft_edit`, `draft_restore`), aimed by the page at
the card the owner has open ([the boundary](../../../docs/security/voice-boundary.md#the-one-draft-write)). A session may
run them too, the same way.

- **The text** is the editable shape `slack draft list --json` prints as `editableText`: Slack's own markup for a
  link (`<url|label>`), a person (`<@key>`) and a group (`<!subteam^handle>`), `` `code` `` and `*bold*` marks (never around a tag or a link),
  `- ` lines for dot points. A one-card gaining dot points becomes a one-list and the reverse; a drip stays a drip
  of one line, since a parked draft is one message (`src/outbound/slack/draftRevisionText.ts`). Spacing is normalised: each line
  is trimmed and extra blank lines are dropped, and nothing else is.
- **What it fixes**: channel, identity, thread, files and prior-ask proof stay the row's own. A rewrite may drop a
  tag or an `@here`/`@channel`, never add or repeat one; reaching someone new is `slack draft record --supersedes <id>`.
  A restore puts an earlier version back whole, its tags included, so it never reaches past what the row has held;
  a version parked in a shape a revision cannot carry (a plain payload) is refused rather than hiding the row.
- **What it refuses**: a bot row, a resolved row, a row whose words the text cannot write back exactly (italic,
  bold code, a bold link, a literal `*` or `` ` ``, a link holding `<`, `>` or `|`, a card line reading as a dot point), a
  rewrite with a stray mark, an empty dot point, a bold tag or link, or a `|label` on a tag, a row whose Codex pick is owed, and a row carrying the owner's yes. Set
  that one down first with `slack draft hold <id> --reason not-owner-yes`; the new words then wait for a fresh yes.
- **Every version is kept**, and `versions[].text` reads each one's payload, the words a release binds, never its
  form. A restore appends the earlier words as the next version and deletes nothing. The
  digest moves with the words, so the release command the card prints always names the current ones. It binds
  words, not a version: a restored version carries its own digest again. A release journals the digest it sent, so a
  revision landing mid-send leaves the released row showing the words that went out (`sentRow`); a thanks-instead
  release sends none of them, so it journals the thanks line and no digest.
