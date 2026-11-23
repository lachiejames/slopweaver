# The card form, field by field

The typed form `--as bot` takes, and every rule the schema enforces on it. The contract — you fill a form,
never a message, and every text field is PLAIN TEXT — is in [SKILL.md](../SKILL.md).

```json
{
  "kind": "update",
  "intro": ["a scheduled post's day-one lines only — see below"],
  "tldr": "One short line that leads the above-the-fold region.",
  "primaryLink": { "label": "Draft PR", "url": "https://…" },
  "index": [[{ "type": "text", "text": "🔴 the thing that most needs a person" }]],
  "indexStyle": "ordered",
  "detail": [
    {
      "type": "paragraph",
      "runs": [
        { "type": "text", "text": "Lead-in: ", "bold": true },
        { "type": "text", "text": "then the prose. " },
        { "type": "text", "text": "inline-code", "code": true },
        { "type": "mention", "person": "<identity-map key or handle>" },
        { "type": "group", "handle": "<user-group handle, e.g. engineers>" },
        { "type": "link", "label": "the PR", "url": "https://…" },
        { "type": "citation", "citationId": "c1" }
      ]
    },
    { "type": "bullets", "items": [[{ "type": "text", "text": "one point per item" }]] },
    {
      "type": "table",
      "columns": ["Thing", "Result"],
      "rows": [[[{ "type": "text", "text": "a" }], [{ "type": "text", "text": "b" }]]]
    }
  ],
  "citations": [{ "id": "c1", "label": "[1]", "url": "https://…" }],
  "media": []
}
```

## The form kinds

`kind` picks which parser reads the rest, and the set is a REGISTRY — `BOT_FORM_KINDS` in
`src/outbound/artifact/botFormKinds.ts`, one entry per kind, each carrying one canonical fixture per branch
that composes prose differently — `alert-summary` has five. A fixture may IMPORT the
function whose output it covers rather than restate it: two of the `alert-summary` ones call
`defaultIntro` (`src/live/automation/firstFiring.ts`), so a reworded day-one intro reddens on the next push
instead of on a channel.
Enumerating it is what lets `derived-card-voice` claim coverage by construction rather than by a list
somebody maintains.

| `kind`              | What the posting IS                                                         | Who writes the layout      |
| ------------------- | --------------------------------------------------------------------------- | -------------------------- |
| `update`            | a LAYOUT — you decided what sits above the fold                             | you                        |
| `no-fold`           | a message rendering ENTIRELY above the fold, no card and no `detail`        | the form                   |
| `digest`            | a TRIAGE LIST — severities, tickets, owners; ranked P0-P4 with `alerts`     | `digestToUpdate`           |
| `alert-summary`     | a TALLY — what fired and how often, plus its comparison clause              | `alertSummaryToUpdate`     |
| `finding`           | ONE issue an investigation found, ranked P0-P2, bot-authored                | `findingToUpdate`          |
| `automation-prompt` | an automation's PROMPT — the bot's own instructions, to the owner's DM only | `automationPromptToNoFold` |

`update` is the FALLBACK: a payload naming no kind, or naming one nobody declared, is read by the update
schema so that schema names the violation. The other five refuse a mismatched `kind` outright.

**A derived kind gives you the FACTS and never the sentence.** You do not write a `tldr` on a `digest`, an
`alert-summary` or a `finding` — the form composes it, and the form is what the voice gate reads. That is
the whole point: a hand-typed lead sentence passed every schema in this file and still shipped an em dash the
operator bans.

An `alerts` block ranks a `digest` by item `impact` and caps its `lead` at 60 ([matrix](../../automation/reference/priority-matrix.md)).

A `finding` derives its priority, and is refused below P2, tracked, short of three pictures, or other than an approved
bot draft into the channel and thread its card named, never a DM, and that thread is one a person started, never a bot alert's: no gate checks the root's author, so the card's composer does ([who-will-see-it](who-will-see-it.md); [a finding card](../../automation/reference/finding-card.md), [draft-review](draft-review.md)); a costed P0/P1 must tag its `escalate` people, nothing else may.

### A post to the owner's own DM declares what it is for

The owner's bot DM carries three things and nothing else: an investigation finding the owner might share, a
dogfood case, or a message the owner asked for. So `slack post|reply --as bot` aimed at
`slackBot.ownerUserId` or `slackBot.promptChannel` takes
`--dm-purpose investigation-finding|dogfood-case|asked-for`, and a send there without one is HELD, with no
hatch (`src/outbound/slack/dmPurpose.ts`). The hold compares against those two configured ids, whitespace trimmed, and
resolves nothing: a `D…` id for the same conversation that is not the configured `promptChannel` is not
recognised, so configure both.
A run waiting on the owner is a Queue card while the board marks it as waiting on the owner (`ownerWait`); paused, terminal or since-ruled it is at most counted there, with its doc archived, renamed or removed it shows nowhere, and no sender of it remains. The recipe card and automation
senders declare their purpose in their argv.

**A post there that ASKS the owner something is refused, whatever purpose it declares** (a question like this belongs in the queue, and the owner does not check the DM).
The check reads the authored prose — link labels, mentions and `quoted` runs are skipped, so a URL's
`?` or a quoted monitor title is not a question — and refuses a word closed by `?`, or a phrase in
`ASK_PHRASES` (`reply yes`, `let me know`, `waiting on you`, `could you` …) that asks without one. Put the
question on the owner's Queue with `handover ask <slug>` or `handover register --ask …` and send the finding without
it. A `automation-prompt` is exempt: its question is addressed to the bot. No hatch
(`src/outbound/slack/ownerDmAsk.ts`, which carries every word the owner has said about this DM).

## Above the fold: `tldr`, `index`, and a day-one `intro`

A reader sees `tldr` and every `index` line before the Details label. `index` is where a list of several
independent things goes, one clickable line each — up to **nine** lines (`INDEX_MAX_ITEMS`), so the headline plus
the index is ten lines (people would rather see more above the fold than have to
expand). The extras still go in `detail`.

- Each index line ≤ 120 visible characters; `tldr` plus every index line ≤ 1080 (`ABOVE_FOLD_VISIBLE_MAX`, a
  full `tldr` plus nine 100-character lines). Over either count is REFUSED, never truncated.
- `indexStyle`: `bullet` (default), `plain` (no glyph, for a derived line that leads with its own), or
  `ordered` — **the colour-coded ranked list**: Slack numbers it, and every line must open with 🔴 🟠 🟡 or 🟢 and
  a space. The rank order is yours; only the colour is checked. An `alert-summary` derives `ordered`, and its
  lines are the priority matrix — 🟡 there means a state nothing reported, which is why that
  glyph is in the rank set and not in the three severities (`skills/automation/reference/priority-matrix.md`).
- Measured in the owner's Chrome: a full 1080-character ten-line card rendered its whole list above
  Show more, which landed on the Details label. One window's answer — photograph yours with `slack shot`.
- `intro`: one to four plain lines drawn ABOVE the `tldr`, only on a scheduled post's FIRST firing:
  this is a trial, how often it posts, reply to say whether it helps and it gets turned off if not, and what
  it covers in this channel. Each ≤ 120 characters, no line break, plain text — so it can tag nobody. It sits
  outside the 1080 cap. A recipe row derives it; see `skills/automation`.

## Below the fold, first: what would CLEAR each ranked finding

The two alert card kinds (`digest`, `alert-summary`) carry an optional `recommendations` array, rendered as
the FIRST detail blocks — a bold `Suggested next moves` line and one list line each. Monitoring says something is wrong and not how to fix it, so a team's daily post names the act that would
clear each finding, plus one or two opportunities nothing alerted on. Nothing on the card composes one, and
nothing on the card raises one — but a line MAY report a draft pull request the bot already wrote, which is
what `raisedPrUrl` carries.

```json
{
  "act": "raise-pr",
  "change": "exclude TaskTransitionError — one stuck draft plan, not a defect",
  "target": "acme-admin apps/ops/datadog/monitors/paymentFsm.ts",
  "owner": "payments (team:core)",
  "evidenceUrl": "https://us3.datadoghq.com/monitors/100001",
  "finding": "red"
}
```

- `act` is `raise-pr`, `tune-monitor`, `change-config` or `hand-to-owner` (work that is none of the other
  three — a reconciliation, a refund call); `change` ≤ 90, `target` ≤ 57 (rendered as code),
  `owner` ≤ 24 as PLAIN TEXT — never a mention, because day one tags nobody. `evidenceUrl` is required.
- `finding` is the cleared finding's severity, which colours the line's glyph; absent renders 💡, an
  opportunity. The VERB sets it — a card is never handed the key it matched on.
- `raisedPrUrl` is the draft pull request the bot ALREADY RAISED to clear this recommendation. It REPLACES
  the act word with a clickable `Draft PR`, and the `evidenceUrl` chip stays where it was — evidence is what
  justified the line and the pull request is its output, so naming the same address for both is REFUSED.
- At most five. The widest line is exactly 200 visible characters without a raised pull request and 195 with
  one, so a line is never trimmed mid-sentence.
- The row AUTHORS them (`params.recommendations`, with `clears` naming what each one clears) and the verb
  selects: see `skills/automation`. Nothing composes one on a clock.

Rules the schema enforces, so do not fight them:

- `detail` is **required and non-empty** — a card that does not fold was rejected outright.
- `tldr` ≤ 180 visible characters; one paragraph ≤ 650; total detail prose ≤ 1800.
- Past 900 characters of prose the detail **must** contain a `bullets` or `table` sub-block.
- A `citation` chip must point at a citation that exists. Carrying **no** citations stays advisory — a card
  with none is allowed, and `--dry-run` will simply say so. **Declaring one is not advisory.** A citation
  the form accepts is rendered as an inline `[n]` link or the send is REFUSED; it is never accepted and
  dropped, which would silence the `no-citations` advisory while showing the reader nothing.
- **Write `[1]` where the claim is, and the form makes it the link.** A `[n]` marker typed into a text run
  is CONVERTED into the chip for the citation whose `label` is `[n]`, exactly as a bare URL is converted
  into a `link` run. Three things are then REFUSED rather than posted quietly: a marker naming no declared
  citation, a marker in `tldr` (a plain string, which can hold no chip), and a citation that no chip points
  at. A card declaring no citations at all is left alone, so `rows[0]` in prose is safe.
- **A COMPLIANCE CONTROL named in an item must be cited in that same item**, and the card door enforces it
  exactly as `turn answer` does (`src/cli/citedControlsDoor.ts`). "Item" is a
  paragraph, one bullet, one table ROW or one index line; a citation in a different block does not ground it.
  A citation names a control by `sourceRef.id`, or by having that control's own page as its `url`; citing the
  page the bare-reference pass linked satisfies it. Only ids this install's atlas holds are checked. Past a
  list you cannot shorten, `slopweaver hatch open uncited-controls --reason "<why>"` journals a 30-minute grant.
  MEASURED: before this door existed, a card naming fifteen controls with no citations sent with
  one advisory warning. **This form caps citations at nothing at all**; `turn answer`'s budget is the larger of
  `CITATIONS_MAX` and the answer's own item count, so only a dozen-plus controls in ONE item refuses there.
- **A COMPOSED `update` card naming three or more things with no picture is held once** on _"which of these
  would a picture show better than text?"_ (`src/cli/cardPictureDoor.ts`). Attach it with `--media`
  or pass `--no-picture-because "<why>"`, recorded on the send's door-ledger row. Derived kinds, a send
  carrying `--idempotency-key` and `slack edit` are never asked, and a reason where nothing was asked is refused.
- **The `[n]` numbering is DERIVED, not authored.** The citations are renumbered `[1]`, `[2]`, … in the
  order a reader meets them — `index` first, then `detail` — and the array is sorted to match. Whatever
  labels you write, the markers come out in reading order.
- A `mention` names a PERSON, never `<@U…>`. It resolves by **exact match**; an unresolvable person is a
  hard error before anything is sent.
- A `group` names a whole Slack USER GROUP by its **handle** (`engineers`), its `@handle`, or its `S…` id —
  never its display name, and never `<!subteam^S…>`. It resolves against the user groups `refresh` hydrates
  into the structure index, and it is REFUSED — before anything is sent, naming the reason — when the group
  is disabled, has no members, is named rather than handled (`Engineering` is the name; `engineers` is the
  handle), or answers to two groups at once. The first two matter most: both would render as a perfect
  mention that notifies **nobody**. `slopweaver identity resolve <handle>` says which group a token names.
- **A text run never carries a raw link or a raw mention.** `rich_text` does not parse a text run, so a bare
  `https://…` renders as dead prose and a `<@U…>` shows the reader a user id. Say it with a `link` run or a
  `mention` run. Two things then hold without you having to remember them: the form **CONVERTS** a bare URL,
  a `<url|label>`, a `<@U…>` and a `<!here>`/`<!channel>` into the typed run at composition, and the send
  door **REFUSES** any payload whose text runs still carry one — so a hand-built payload cannot slip past.
  A `code: true` run is left alone, because a URL in a code span is meant to be read rather than clicked.
- **`<#C…>` is REFUSED**, not converted: there is no channel run in this vocabulary, so name the channel in
  prose or link it. `<!subteam^S…>` **is** converted, into the `group` run above.
- **`tldr` is a plain string with nowhere to put a link**, so a URL in it is refused — `primaryLink` is where
  the one canonical link goes.
- **Never write a bare PR number or ticket key — always a link.** `#<n>` and `ABC-1` typed as plain text in
  a text run are resolved into a `link` run automatically wherever the repo (or the connected Linear
  workspace, for a key) is unambiguous; a reference the door cannot resolve is REFUSED rather than sent bare,
  naming each one. The `bare-refs` hatch is the journalled break-glass. The same rule applies to
  `--as me` (both the form and the plain `--body` escape hatch) and to `edit` — not only the bot's own card.
