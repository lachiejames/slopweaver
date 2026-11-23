# The no-fold form, and how to prove a message does not fold

`{"kind":"no-fold"}` is the bot lane's SECOND outbound form: a message that renders entirely above the
fold. It is a sibling of the card, not a mode of it.

**Why it exists**: a policy-acceptance DM in the owner's own bot DM wants everything above the fold, with no
below-the-fold. If the bot DM cannot do that, the Slack schema is missing the form that would, and the fix is to
write that functionality. And a second form rather than a flag, because there are multiple Slack schemas for
posting messages, different forms to fill for different use cases: most of the time a message folds, but
sometimes it must not.

## What actually causes the fold — read this before claiming anything

This repository asserted, from a twelve-variant matrix, that **the fold is a function of block count alone
and more than five blocks folds**. That is REFUTED. The owner's own folded policy DM is a THREE-block attachment —
`context`, `divider`, `section`, no `Details` label — and it renders "Show more". Count it yourself:

```bash
slopweaver slack read-thread <the permalink of a folded bot card>
```

Length does not replace the rule either: about 500 visible characters folded and 480 did not, which is a
bracket around a number nobody has measured rather than a threshold.

What SURVIVED that matrix is the other half, recorded in `src/outbound/slack/types.ts`: **the legacy
`attachments[]` wrapper is what makes a message fold — the identical blocks posted at TOP LEVEL do not.**
The as-me lane has posted top level for weeks and has never folded a message. So this form's guarantee is
STRUCTURAL rather than numeric: `SlackNoFoldPayload` has no `attachments` key on the type at all, and its
`blocks` is a one-element tuple. There is no threshold to get wrong because there is no number in it.

**The price, so it is not a surprise.** The violet bar is the wrapper's `color` and the author row is a
block inside the wrapper, so a message with neither has neither. Slack's own message header still says who
sent it. That is the trade: identity chrome for a guarantee that nothing is hidden.

## The shape

```json
{
  "kind": "no-fold",
  "lead": [
    { "type": "mention", "person": "<identity-map key>" },
    { "type": "text", "text": " " },
    { "type": "link", "label": "Open your Vanta security tasks", "url": "https://app.vanta.com/employee/onboarding" },
    { "type": "text", "text": " and press " },
    { "type": "text", "text": "I have read and I accept these policies", "bold": true },
    { "type": "text", "text": ". You have 1 policy left to accept:" }
  ],
  "bullets": [[{ "type": "text", "text": "Code of Conduct" }]],
  "trailing": [[{ "type": "text", "text": "Reply here if the link does not work." }]]
}
```

Three fields, in render order. `bullets` and `trailing` both default to empty, so one `lead` line is a
valid message.

**That URL is not an example — it is the one address that carries the Accept action, and the form refuses
the other one.** The first version of this very message downloaded a PDF when the link was clicked, instead of taking the
reader to the Vanta accept page. The
links were the policy DOCUMENT addresses Vanta's Manage API hands back
(`app.vanta.com/c/<tenant>/…/doc/<Name>-<slugId>`, stored in the atlas as a `provider-provided` deep link),
and on the owner's own signed-in profile one painted an entirely blank page and downloaded an 80.8 KB PDF. The
accept surface is the reader's OWN security tasks — `https://app.vanta.com/employee/onboarding`, which
redirects a signed-in reader onto their tenant's copy, so it names no tenant and is the same address for
everybody. A `link` or `primaryLink` carrying the document shape is REFUSED by the form, and so is a bare
one pasted into prose, which conversion would otherwise turn into a link after the field check. That covers
every FORM-FILLED message, which is everything `--as bot` can send;
`src/outbound/artifact/vantaLinks.ts` carries the measurement and names the four things outside it, of
which only one is a bot payload — `renderRecipeResponse`, which posts an already-rendered wrapper and whose
only producer was deleted with the spawn-dispatch family.

## Its bounds, and why each one is there

| Bound          | Value                          | Why                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run vocabulary | `text`, `link`, `mention` only | A citation chip's footnote lives below a fold this form does not have. A `group` and a `broadcast` both address a ROOM, and a per-person DM's caps assume one person's list.                                                                            |
| Whole message  | 650 visible chars              | `PARAGRAPH_VISIBLE_MAX` — an existing measured constant, reused. Every character here is above the fold, so the bound is on the WHOLE message and splitting it into lines buys nothing. **It is not a fold threshold and must never be quoted as one.** |
| Dot points     | 8, of 200 chars each           | The card's own bullets bounds.                                                                                                                                                                                                                          |
| Trailing lines | 4                              | Past this the message is a report, and a report wants a fold.                                                                                                                                                                                           |
| Newlines       | refused                        | `lead`/`bullets`/`trailing` ARE the line structure, so a `\n` inside a run is a line nothing downstream can see.                                                                                                                                        |
| Media          | refused                        | Attaching a file re-sends the message with an `attachments` wrapper, which is the fold. There is no `uploads` parameter on `sendNoFold` at all.                                                                                                         |
| Editing        | refused                        | `slack edit` re-renders as a CARD, so an edit would republish it wrapped. Post a new one and `slack delete` the old.                                                                                                                                    |

An over-width message is REFUSED, never truncated, and the refusal names `{"kind":"update"}` as the form
with somewhere to put the rest. There is deliberately no override: an escape hatch that let a folding
payload keep the name `no-fold` would falsify the only thing the form promises. Same shape as the door's
own `hold` — it names the absence and gives the correction.

## Proving it, which is the only claim that counts

**Never claim a message does not fold from a preview, a block count or a character count.** The preview
says so itself now, on its second line, on every card. The fold is drawn by the CLIENT, and no Slack API
returns anything about it — `conversations.history` returns the blocks we sent.

```bash
slopweaver slack shot <message-permalink> --out $SLOPWEAVER_HOME/proof/<slug>/message.png
```

It opens the conversation in the owner's own Chrome through the Playwright extension relay
(`docs/browser-route/target-proof-and-playwright.md`), navigate-and-photograph only
(`docs/browser-route/proof-and-capture-verbs.md`) — no click, no typed text, no page script, so the missed-click
incident's shape (`docs/browser-route/provider-arms.md`) is not available to it at any
price. `browser shot` still refuses Slack by name, and that refusal is correct; this verb is rule 3's own
answer, a slopweaver verb driving the owner's browser IS the door (`docs/browser-route/provider-arms.md`).

Three things it does that are MEASURED rather than chosen:

- It opens the CLIENT route, never the `/archives/` permalink. That permalink is an interstitial whose job
  is to hand the conversation to the desktop app, and through the relay it closed the tab mid-navigation.
- On an enterprise grid it uses the ENTERPRISE id. Handed the team id, the client redirected to
  `/activity-inbox` and photographed that — a successful capture of the wrong thing.
- It photographs the conversation's NEWEST messages and takes no scroll, so photograph a message just
  after posting it.

**Make the witness fire before you quote the result.** A picture showing no "Show more" is only evidence if
the same capture route can show one. The proof that shipped with this form does it in a single frame — the
new no-fold message at the bottom with no fold, and two older attachment cards above it both rendering
"Show more" — at `$SLOPWEAVER_HOME/proof/no-fold-slack-schema/no-fold-proof-12sep-1121.png`, of the message
at `D0SYN000001` ts `1789176080.417389`.

**Two claims, and only one is enforced.** The payload STRUCTURE is guaranteed: no wrapper, one block,
checked by the type and again at the send seam. That a message of this structure does not fold was
OBSERVED, in one client, in one window, once. It is strong evidence and not a proof about every client at
every width — so the honest sentence is "it carries no wrapper, and a wrapper is the only fold cause
anything here has measured", never "it cannot fold anywhere".
