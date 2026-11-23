# A Codex draft beside the Claude draft

Part of [the console](../console.md). Every NEW Queue draft card shows a Codex draft beside the one the session
wrote, straight away, as an A-or-B the owner picks. It is never retroactive. The owner gives feedback as they go, and
the goal is the owner's voice-rule steers falling to zero.

## What the card shows

A post card whose row carries a ready Codex draft and no pick draws both, labelled:

- **A**: the original inside its live conversation, labelled with who wrote it (`Claude's draft` when the
  recording ran in Claude Code).
- **B**: Codex's draft, drawn as Slack would draw it.

The question becomes _"Claude's draft or Codex's?"_, or _"The recording session's draft or Codex's?"_ when the
recording could not tell which host ran it. The options are A (choose the original), B (choose Codex's) and C
(leave both parked). Choosing is never sending: either pick still waits for the owner's yes. The console voice's
`read_card` returns both texts as `drafts`, each with who wrote it, and asks the same question, never saying
which is better.

**On an ask or hand card** that asks the owner to send ONE held draft, the post card is absorbed into it
(`site/lib/queueDraftOwnership.ts`: one held draft, one Queue card). Its letters are the ask's own
options, so the panel labels the two drafts by writer — the original's (`Claude's draft`) and _Codex's draft, written
blind to Claude's draft_ — and an ask's what opens on the choice. The voice's `read_card` returns both as `drafts` on
that card too.

**B that drops A's receipt is drawn but not offered.** When A brings links as
its receipts and B's words carry none, `slack draft list --json` marks the item `codexDropsReceipts`, derived once in
the CLI (`src/outbound/slack/draftComparison.ts` `candidateDropsReceipts`); the card warns above B that it drops the
receipt A links to, option B becomes a re-cut with the link done in a session, and `pick --variant codex` refuses.

**B that raises a finding the row cannot prove is drawn as refused.** A pick keeps the row's
media and impact, so a B whose form declares a possible problem without them is refused at admission, and one admitted
earlier lists as refused at admission (`src/outbound/slack/candidateFindingProof.ts` `listedComparison`).

## How a row gets one

`slack draft record` parks the original first, so the comparison can never cost the original its park. Then,
on a new as-me row with no approval, no media, and an original not composed by a Codex session, it runs one
sealed Codex pass ([the boundary](../security/codex-boundary.md)). The pass is blind to A: it sees the
conversation, the row's destination and purpose, and the owner's voice brief. Its answer is admitted exactly as the
original was: the owner's exact voice rules (any finding refuses B outright, where A carries them as advisory), the
same drip preparation under the `--reviewer` the recording declared, the earns-its-place and problem-declared
checks, and the untagged-name hold. B gets its own digest over A's destination, identity and prior-ask proof.

So B is drafted from less than A was. Whatever A's session investigated outside the conversation (a repository, a
dashboard, a document it was shown) never reaches B, since that session's context holds A itself. An app card's
words, from its attachments and Block Kit sections, reach B as Slack shows them; a file, a picture, or a card with no
words is marked on its message's line, beside any text and after the line's length cut, but not drawn, and the prompt
tells B to say only what it was given supports. A pick therefore weighs voice together with what each draft knew, and the counts are the owner's preference over the
pairs the owner was shown, never a controlled test of the two models.

Two kinds of new card get no B, and each is a narrowing of "every new card", stated rather than implied. A
`--as bot` card speaks as the bot, not as the owner, so it cannot answer the question the comparison exists for
— which model is closer to what _the owner_ would say. A card carrying media would put a B written blind to the
picture beside an A written around it, and a pick of B would have to decide what the media means under new
words. Both are widenings to make on the owner's steer once the as-me cards have told the owner which model is closer.

A retry (`slack draft compare <id>`) re-reads the conversation, since the park kept identifiers and never
text. It reads the page ending where the recording's read ended and drops every message added since, so B
sees what A saw. A message edited or removed since cannot be restored that way, so the retry journals a final
`refused` at stage `evidence` and the card keeps A alone, free to send. A retry that cannot read the
conversation at all, or resolve a token for it, journals `unavailable` rather than leaving the row `pending`, so
A is freed and a later retry may still try.

B is blind to A by check, not only by instruction. The sandbox is read-only but reads anywhere, and A is parked
before the pass runs, so a pass that produced anything but a message and its reasoning (any tool, a plan list included), or whose activity
was not measured, gives no B and the row reads
`unavailable`. Every line of the prompt's "Where it goes" section (the destination, the act, the purpose line and the
re-ask declaration) is written or chosen by the session that wrote A, and the check reads the lines the prompt itself
is built from, so any of them carrying six of A's words in a row, or the whole of a shorter A, refuses B at stage
`evidence` before Codex is asked. A's words are read as Slack shows them, ignoring case and accents: each link or date token as its label or as its own text, chosen token by token, an escaped `&amp;` as `&`, and a mention as any
one to four words, each counting toward the six, since the purpose may write the name where A holds an id, so an A of mentions alone gets no B. A shorter
shared run passes on
purpose: a purpose line names the draft's subject in the draft's own words, and refusing every shared phrase would
refuse B on most rows. A pass or admission that throws after the park journals `unavailable`, so A is freed. Words A shares with the
conversation itself, a reply repeating what someone already said, or with the owner's voice brief, a phrase lifted from the owner's own
examples, reach B as part of what both drafts are given: the check keeps A's own composition out, never what the thread
or the owner's brief already holds. One
reach is outside the check, as any process on the owner's machine is: a globally configured MCP server is still started and
lists its tools, which no override disables ([measured](../security/codex-boundary.md)), so a server that wrote A into
its own tool descriptions would reach B without a tool call. So would the owner's global `AGENTS.md` in the Codex home,
which Codex loads into every thread as instructions: one already carrying A's words reaches B, the same as any file
on the owner's machine Codex reads before the prompt. The pass's own workspace is a fresh empty directory, and a file found
there when the pass ends gives no B; a process that writes one and removes it again before then is not seen. A date token's rendered date is not read either, since
it is the reader's locale and timezone: an A that is only a date token, retyped as its rendered date into the purpose,
reaches B. Nor is a display name past four words, since a wider mention would swallow more of an unrelated purpose and
refuse B where nothing of A was quoted.

The outcome is journalled as a `compared` event under the register lock, and only while the row is still held,
unpicked and unapproved. A candidate is always a rich message, as a pass renders one: a line carrying a plain one
hides its row, as any malformed line does, since Slack would read its text as markup the card draws literally. The fold reads a ready candidate whose digest is not the one its own words mint under the
row's destination and identity as `refused`, since only a hand-written line can carry one: the card draws B's words
and a release re-renders B's form against that digest, so what the card shows is what goes out, or nothing does. A
hand-written line whose form will not render, or renders other words, is not refused at the fold, since rendering a
form needs a live mention read; its release refuses instead, and the row's own words are never swapped for others.

| State         | Means                                                                        | Next                       |
| ------------- | ---------------------------------------------------------------------------- | -------------------------- |
| `pending`     | owed, no pass finished yet (a record killed mid-pass)                        | `slack draft compare <id>` |
| `unavailable` | no seat, the pass failed or used a tool, or the read failed                  | `slack draft compare <id>` |
| `refused`     | B failed the owner's rules or A's admission, A's evidence moved, `--why` = A | the card shows A alone     |
| `ready`       | B sits beside A — final                                                      | the owner's pick           |
| `skipped`     | approved at record, carries media, or composed by Codex — never owed         | none                       |

## The owner's pick

`slack draft pick <id> --variant original|codex [--anchor <a>]` records it once. `approve <id> --variant ...
--anchor <a>` records the pick and the owner's yes together under one lock. A `codex` pick makes B the row's words
and digest and keeps A's beside the row; an approved row's words are never swapped. While a pick is owed,
`approve` without `--variant` and every release refuse with `DRAFT_PICK_OWED`. A `pending` row owes it too, so
A is never sent before B was ever shown: its refusal names `slack draft compare <id>`, its card says B has not
arrived, and an `unavailable` or `refused` outcome frees A.

`slack draft list --json` carries `picks`: the owner's choices counted by variant and by the Codex model asked. That
is a preference the owner expressed, never a quality score.

## Five limits, stated

- A seat whose build predates the comparison cannot read a `compared` or `picked` line, so it hides that row
  and fails closed rather than sending words it cannot see were swapped. Before that line lands, it treats a
  `pending` row as an ordinary held draft and would send A, where a current build waits for B.
- The comparison runs only where `slack draft record` runs: a row recorded through any other path owes none.
- A release takes no register lock across its Slack send. It re-reads the row after its own gates, again after
  the send-only gates, and once more inside the door, with only the first message's claim between that read and the send, and
  refuses if a comparison landed or a pick changed its words, so what is left is the send call itself: a pass
  or a pick landing inside it leaves B ready, or picked, on a row whose A is going out under the digest the owner's
  yes named; the row then reads released, and B is never sent. A `compared` line a pass appends after the release
  folds to nothing, since a comparison lands only on a held row. Likewise a release can send the picked words
  between `approve --variant`'s pick and its yes; that approve then says the row moved, and offers no re-run.
- There is no budget of its own. Each pass is routed like any Codex pass, on the owned plans and never a
  purchase, and becomes `unavailable` when every seat is capped. So an owed-reply firing that parks ten
  drafts spends up to ten passes of at most 90 seconds each, on the same seats planning and review use.
- A register that will not read leaves a row `pending`. The register reads a failed read as empty, as every
  `slack draft` verb does, so a park that cannot be read back says so and asks for `compare` once the register
  reads; while it cannot, no verb can release the row either. A `compared` line torn by a failed write hides
  the row, as a torn line of any kind does: the register fails closed rather than act on a row it half read.
