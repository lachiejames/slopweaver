# A Slack draft drawn as Slack draws it

Part of [the Queue](./queue-and-triage.md), in [The console, the board, and the session ledger](../console.md).

What the owner sees on a draft's card looks exactly as the message will look in Slack.

## Who, and where

The draft draws the owner's own Slack avatar and name beside the message, and the conversation header Slack draws above
it — `# channel`, or a DM peer's face and name. Both come from the roster's 72px avatars (`slackAvatar72`,
`src/corpus/members/slackPeople.ts`): the `image_72` the identity resync projects, else the row's kept 512px
`avatarUrl`. Never the raw member's own URL, which member redaction has carved up.

## The conversation it lands in

A draft drawn alone makes the owner step into Slack to see what came before it. So opening a HELD
draft's card calls `/api/draft-context`, which runs `slack draft context <id> --json` (`site/lib/draftContextVerb.ts`)
live through the door, never the corpus. The card draws it native-Slack above the draft:

- the thread it replies in, with the root and last three replies open and the middle folded;
- or the channel tail it posts into;
- in both, names resolved and an _open in Slack_ link.

**The conversation reserves its space before it arrives**: it sits in one fixed-height slot,
scrolled to its newest message, and while the reading is in flight that slot holds a _reading the conversation…_ line
over skeleton messages (`ConversationSlot`, `ConversationLoading`, `DraftConversation.tsx`), so the draft below it
never jumps when the thread lands. The panel reads it ONCE (`useDraftContext`) and hands the same reading to the
draft's slot and to the card's _In thread_ property. The draft itself sits in an amber _draft · not sent_ frame. A
reading that fails draws a staleness mark whose hover says why, and the card draws the draft alone under the old
parent line.

**It says what changed since the draft was written**, quietly: the owner wants to know what has happened since the
card was created, without that notice taking over the card. The verb measures it off
the same read with the release's own classification (`sinceDrafted`, `src/live/slack/draftContextSince.ts`, over
`conversationChanges` in `releaseFreshness.ts`), counting every author, so the card can only ever report more than
the release would. The card draws one quiet line under the read-live line (`SinceDraftedDetails.tsx`, words in
`site/lib/sinceDrafted.ts`), warning ink only when something moved, opening onto each new or edited message and a
removed count. A channel tail is one page, so it is judged only inside that page and says what it could not see; a
read with any such limit says _No changes found in this read_, never _Nothing has changed_.

A person's own message sent through an app on their token carries a `bot_id`, and Slack draws it as the person.
So only a bot member, or an app with no member behind it, is badged APP (`site/components/live/readDraftContext.ts`).

## Attachments

Every attached picture is drawn INLINE from the exact bytes the digest binds, through `/api/draft-media/<sha256>`
(`site/lib/draftMediaServe.ts`). The route takes a 64-hex name only, refuses a linked directory or blob, re-hashes
the bytes before one is sent, and serves pictures and videos only.

The layout follows the rules measured off Slack's own render (`site/lib/slackDraftLayout.ts`,
`SlackAttachments.tsx`):

- one image under its filename;
- several as tiles under `N attachments | Download all`;
- a picture or video the browser cannot draw as the marked file card, never a broken element;
- a Linear issue link as its compact card, and a Datadog link as nothing.

A link to a host nobody measured is named under the draft rather than guessed.

## What `slack draft record` refuses

The card cannot make some drafts faithful by drawing harder, so the form refuses them
(`src/outbound/slack/draftFidelity.ts`):

- a bare `[n]` citation in prose, or any bracketed token carrying a `†`;
- a TIFF, under any name;
- bytes that only open like a picture or video, without being one admission proved;
- an attachment whose name and bytes would not draw the same thing.

No byte check at record time proves a browser decodes a file, so the card's fallback to a marked file card is
the last word, not the record check.

## Receipts lead the card

A draft also parks only with its receipts: a link or attachment it carries, else `--self-evident` or `--tried`
([receipts](../../skills/slack/reference/receipts.md)). The post card's what LEADS with one line naming which —
`Receipts: 2 links, 1 attachment.`, `No receipt needed: <why>.`, `No receipt. Tried: <what>.`, or `No receipts named.`
on a row recorded before the rule — ahead of any judgement line (`site/components/live/draftReceipts.ts`). A row
whose receipts do not read is refused by the list reader rather than drawn without them.

A held row raising a finding without a screenshot, a link and its impact in people — or a first message in a channel
without an annotated, unobstructed screenshot and a link — draws NO card: the list marks it `proofMissing`, `isParked`
is false, and a card naming its id draws one muted line saying what it lacked and that it was sent back unseen
(`site/components/live/draftProofMissing.ts`,
[receipts](../../skills/slack/reference/receipts.md#a-finding-owes-all-three-a-screenshot-a-link-the-impact-in-people)).
A cleared first message carries `leadingReceipt`, and its card draws that annotated screenshot and its notes above the
message (`site/components/console/LeadingReceipt.tsx`), never only as an attachment at the foot.
