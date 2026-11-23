# Receipts — a card that makes a claim brings them, or says why not

The owner's ruling, after five cards came back with the same complaint that the session didn't bring the receipts,
in the owner's words: a queue card can't get in front of the owner anymore without the receipts. Two minutes later
the owner bounded it. Never withhold a card because a session thinks it cannot get the receipt: sometimes _"the evidence really speaks
for itself"_. A claim to a person, like a LangSmith bill, wants _"at least a screenshot and a link to where they
can go and see it"_. And on proof that could not be had: _"show what it tried"_.

## Three shapes, and the one that costs nothing

`slack draft record` (as me or `--as bot`) parks a row only in one of these:

| Shape          | How                                           | The Queue card leads with          |
| -------------- | --------------------------------------------- | ---------------------------------- |
| `attached`     | a link in the message, or a `--media` file    | `Receipts: 2 links, 1 attachment.` |
| `self-evident` | `--self-evident "<why no receipt>"`           | `No receipt needed: <why>.`        |
| `tried`        | `--tried "<what was tried, what stopped it>"` | `No receipt. Tried: <what>.`       |

`attached` is **derived**, never declared: a link anywhere in the rendered message (a `<url|label>`, a rich-text
link, a button) or a file under it is something the reader can open, so bringing one costs no flag. `--tried`
beside a link rides as what is still missing (`Still missing, tried: …`). `--self-evident` beside a link is refused:
the card already brings its receipts. A bump (`--act bump`) re-surfaces an earlier message and owes none.

Two verbs record through the same path and declare for themselves, and each declares nothing only when
`formReceiptLinks` (`src/outbound/slack/formReceipts.ts`) — the drip parse, then the recorder's own `receiptLinks` —
finds a link on the very form it parks. A prefix match was wrong three ways: the parse links a bare address in the
text, links `mailto:` which is no receipt, and refuses an address with only a scheme. It is a lower bound: the record
path may then link a bare Linear key, never unlinks, and keeps a `--tried` beside a link it adds as `attached`. A review ask links the pull
request, so derives it, else records `--tried` naming the address (`reviewAskReceiptsOf`). A `workstreams loop-in`
opener is mined text whose basis is its candidate's evidence, never `self-evident`, so it ends on the first evidence
item that derives; with none, on its own text when that derives; and only with neither records `--tried`
(`loopInOpenerOf`). Both fold a line break in what they quote (a title, an opener) to one space, since a parked
draft is one drip message and its parse refuses a break inside one. Neither truncates for length: an opener past the
operator's visible cap is refused for its length, never for its receipts.

A card with none of the three is refused, every shape named. **There is no hatch**: each way through is a
declaration you can always make.

## A finding owes all three: a screenshot, a link, the impact in people

The owner's word, sending back sd-b5a68451 (year-two repeat orders), which passed the rule above on one Linear
link: no screenshots, no links, no proof of user impact, and, in the owner's words, if you're gonna show the owner
any other queue cards that are also trying to raise a finding like this and missing those key details, don't bother
… send them back.

So a row that RAISES a finding — `--kind finding` whatever its act, or a form declaring `problem: possible` whatever
its kind on anything but a chase bump — parks only with every piece (`src/outbound/slack/findingProof.ts`):

- a `--media` file (the screenshot);
- a link the reader SEES, in its text or a block's rendered fields (one parked in a `block_id` or a notification
  `fallback` is none);
- `--impact "<count> <who> <what happened>"`, leading with how many people and naming who they are (a
  person noun: users, customers, staff…; a count of requests or errors is refused), and that count in the message's FIRST
  line (a card's tldr). A bot `finding` card's MEASURED `blastRadius` (unique users counted) stands in for `--impact`; an unmeasured one does not.

`--self-evident` and `--tried` do not answer it, and **there is no hatch**: each piece is always bringable, and one
that cannot be had means the finding is not ready for the owner. The refusal names every missing piece at once.

A held row parked before the gate is caught at the Queue too: `slack draft list` shows it `no-proof`, `--json` marks
it `proofMissing`, the Queue draws no card for it, a card naming its id says it was sent back unseen, and `slack post`/`slack reply
--draft` refuse to send it, naming the re-cut and the drop. A `slack draft revise` or `slack draft restore` that would leave a finding without a piece is refused
too, since a revision cannot bring a file or an impact. A `--thanks-instead` release is refused the same way: a row
missing its proof never reached the owner's yes, so there is nothing to thank in its place.

Residue: a file is counted, not proven a screenshot; a link is not proven to prove the claim; the count is a number
leading the words, and that its noun is people is the recorder's word.

## A first message in a channel leads with an annotated screenshot and its link

The owner's standing rule, after ten V-card action drafts (sd-09b7eb89 and nine more) reached the owner's Queue on
their links alone, in the owner's words: that first thing coming in with the screenshots coming in with the receipts
on the very first message in the channel is very important to the owner. The owner and the fleet don't go anywhere
without proof. Sharpened that night: the screenshot is cropped and ANNOTATED — a rectangle over the thing to look at,
with notes — and, in the owner's words, make sure the screenshots ALL have annotations; a pop-up, banner or modal is
dismissed before the capture, and an obscured capture is retaken, never worked around; a card failing this is sent
back without being put in front of the owner.

So a row parked at the TOP LEVEL of a channel (a `G…` group counts; a DM and a bump do not), whatever its kind and
whoever it posts as — the owner tagging the bot included — parks only with every piece
(`src/outbound/slack/firstMessageProof.ts`):

- a `--media` picture (a PDF or a video is not a screenshot);
- a link the reader SEES, as for a finding;
- EVERY picture's image record vouching for the box already drawn into its bytes and for nothing covering it.
  `slopweaver browser annotate --form` DRAWS the boxes and their notes onto a capture and writes a pre-filled record
  form beside the output; open the output, then `slopweaver browser image-record --form <out>.image-record.json`
  records it with `annotations: [{ rect, note }]` and `obstruction: "none"`. The record attests; it never draws the
  box. A capture something covers is recorded `reason: obscured` and retaken, never annotated around.

`slack draft record` refuses a row missing any piece, every piece named, before it stores a byte; there is no hatch,
and `--self-evident`/`--tried` do not answer it. The verdict is computed from the image store at every read, never
stamped: a later record vouching for a box already in the bytes clears a held row without a re-cut, and a later
failed record — `obscured` included — sends a cleared one back. A held row missing a piece is `no-proof` on `slack
draft list`, hidden from the Queue, refused at `slack post`/`slack reply --draft` (a `--thanks-instead` too), and its
revise and restore are refused. A cleared row carries `leadingReceipt` (the lead picture's digest and its notes), and
its Queue card draws that screenshot and those notes ABOVE the message, beside the draft, never only at its foot.

Residue: the annotation is an attestation about pixels like every image record — the recorder can write a box it did
not look at, and what the record buys is that the claim is bound to those bytes. A group DM is a DM here (no file attachments are
needed there), but its `C…` id cannot say so: an `--as me` record stamps the
row `groupDm: true` off `conversations.info`'s `is_mpim`, and only that stamp exempts it; the digest binds it, and a release
re-reads `is_mpim` live, refusing a stamped row the conversation no longer backs. A bot card is judged before its
conversation read and is never stamped, and an unstamped row with a `C`/`G` id is held to the proof. A direct `slack post` that is never
parked, a scheduled digest and a recipe response are not covered, and the Codex candidate seam stays finding-only.

## A card the owner sent back for its receipts

When the owner's triage word on a card carried `--feedback no-receipts`, a re-cut of that row (`--supersedes <id>`)
may not call itself `--self-evident`: the owner already said it is not. Put the link or the screenshot IN the message — a page only
the fleet can open is not a receipt the reader has — or say what you tried with `--tried`. The case that set this:
sd-b9230a1c, a re-cut of sd-aca21d36 whose words said "got the receipts" while carrying no link and no file.

The check reads the relay ledger, and a `--self-evident` re-cut is refused when any line of it does not read: that
line's ruling may be the send-back, and read as none it would let the claim through. A line holding a byte that is not
UTF-8 does not read, rather than being read repaired. A link, a file or `--tried`
never reads the ledger at all.

## Codex's draft beside yours

A Codex comparison runs only on a row with no media, so a link is the receipt it can drop. When the original
brings links and Codex's words carry none, the card says so and `slack draft pick --variant codex` (and `approve
--variant codex`) is **refused**. Pick the original, or re-cut Codex's wording with the link via `--supersedes`.
Codex's own links become its receipts on a pick; a `--tried` the original carried rides along.

## Repeated feedback becomes a ruling

Each `--feedback` class the owner names on a sent-back card (`talk relay --triage … --feedback
no-receipts|not-at-a-glance`) is counted on the Alignment page, one count per draft chain so re-cuts of one card count
once. Named on two chains, the page drafts a general-ruling question for the owner's yes (`align:rule-card-<class>`), never applied without it:
[alignment](../../../docs/console/alignment.md).

## Residue, stated

- That a link PROVES the claim is not decidable; that the reader has something to open is.
- A file is counted, never classified: `--media` takes video too, so the card says "attachment".
- `self-evident` is the recorder's word, shown first on the card where the owner can attack it.

Code: `src/outbound/slack/draftReceipts.ts` (rule), `src/outbound/slack/findingProof.ts` (finding proof),
`src/outbound/slack/firstMessageProof.ts` (first message), `src/outbound/slack/draftProof.ts` (the merged verdict every
seam asks), `src/cli/commands/slack/draftRecordReceipts.ts` (record),
`src/outbound/slack/draftSentBack.ts` (sent back), `src/outbound/slack/draftComparison.ts` (Codex),
`site/components/live/draftReceipts.ts` (card line).
