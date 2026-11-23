# Asked before — an answered question is never asked again with nothing shown

The owner's ruling, reading a parked key-spend draft: if they answered _"yeah, it's expected, here's why"_ and a
month later we ask the same thing, then in the owner's words they're gonna look at the fleet and be like … didn't
the owner and the fleet already have this exact conversation a month ago? The default is to **drop it**. The one
other shape is a Queue card carrying our earlier message, their answer and proof of what changed: _"you can't just
tell me something's changed, I need some charts, I need some proof."_ The owner decides.

## The declaration

`slack draft record` (as me or `--as bot`) reads the draft's AUTHORED words with the owner-DM tell — an ask phrase
or a closing `?`, never a link label, a code run or a quoted line. A draft that asks **must declare**:

| Flag                                                  | Means                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `--asked-before none`                                 | never asked; journalled on the row as your claim                   |
| `--asked-before <permalink>`                          | OUR earlier message asking the same; it is read live               |
| `… --changed "<what>" --changed-media <png,…>`        | it was answered, and this materially changed; ≥ 1 picture of it    |
| `… --not-answered "<why the replies were no answer>"` | somebody replied, but not with an answer ("will look", a reaction) |

**Look before you declare `none`**: `slopweaver store hits` over the owner's sent messages for the question's distinctive
terms, then `store around` or `slack read-thread <link>` on a hit. A chase of our own unanswered ask names that ask:
`--asked-before <its permalink>` (an unanswered one parks with nothing more).

## What the recorder checks

- The link resolves to a message **by the identity the draft goes out under** (the owner's for as-me, the bot's for
  `--as bot`); a thread somebody else opened is named by our message in it.
- Every later message by somebody else — not ours, not a bot's, not a join — is an ANSWER. Answered with neither
  `--changed` nor `--not-answered` refuses, quoting the first answer.
- `--changed-media` goes through `slack post --media`'s own admission and at least one entry must be a picture; the
  bytes are kept in the draft-media store and **bound into the digest** with the `--changed` text, so the charts the
  owner approves are the charts the card carries. A row with no proof keeps its old digest.
- An unreadable thread refuses (fail closed). There is **no hatch**: every way through is a declaration you can make.

## An answer at the top of the channel

In the owner's words: replies to the owner and the fleet's messages that are coming at the top level of a channel
… the owner would look silly if the owner said, 'Bump, no one responded to me.' So a channel ask also reads the channel's top level
after ours, up to four days of it, whole or not at all. A considered post is a person's, strictly after ours and
within one business day of it: never ours, a bot's, an app's, a join, or a reply's channel copy (a file shared with a
comment or none counts, as in a thread). The rule, `topLevelTieOf` in `src/outbound/slack/topLevelAnswer.ts`:

- **Answers** when the EARLIEST considered post is by somebody ours asked (tagged by name, in a group or the room
  ours tagged, or anybody when ours tagged nobody but us) and landed within two hours. It refuses as ANSWERED, quoting it.
- **May answer**, held for the owner's judgement, when that earliest post was inside two hours but by somebody ours did not
  ask, or when somebody ours tagged by name posted later in the business day. Alone it refuses with the hold wording
  (_"Hold the bump for my judgment if it's ambiguous"_). It parks only with a declaration, as any answer does:
  `--not-answered "<why>"`, or `--changed` with its pictures. Either way the card shows both messages.
- **Nothing** otherwise: the channel moved on.

The false positive it accepts: an unrelated post by an asked person inside the window reads as the answer. The
refusal quotes that post, so a miss is visible, and `--not-answered` is the way past it. The two-hour window is
provisional (two real answers, 27 seconds and 4 minutes, `store around --id C0SYN000001:1791341338.708319`).
Those two asks are replayed from real Slack in `src/__tests__/integration/slackPriorAskTopLevel.test.ts`, each with
an empty thread, so the top-level read is the only thing that finds the answer.

The Queue card reads in time order. When our earlier message is in the conversation the draft
lands in, it is drawn there, tagged **asked before**: what came before it folded, then an ellipsis for what was said
between, then the latest messages, then the draft. Anywhere else, an **Asked before** block opens the conversation:
our message, the first answer (the rest folded). Either way the claim sits in a box just above the draft: what
changed with its pictures, or why it was no answer. An ask nobody answered owes neither.

## At release

A row that named an earlier ask re-reads it before sending (in the owner's words, a read before and after
every send cancels a re-ask by itself). A reply the row did not record that is newer than the recording's THREAD
read, a top-level post the rule ties to ours included, refuses, and so does a clear top-level answer the row never
recorded (a deleted post can expose an older one). The mark is the thread's alone: the channel is read after it, so
channel traffic never carries it past a reply landing between the two reads. It refuses with
`SLACK_RELEASE_PRIOR_ANSWERED`: read it, then `slack draft drop <id>` when it settles the question, or re-record with
`--supersedes <id>` so the card shows it. `--thanks-instead` re-asks nothing and skips this read.

## Residue, stated

- `none` is the recorder's word; a search of the owner's sent history is the follow-up, held until its threshold is measured.
- "Somebody else replied" is a proxy for answered; `--not-answered` is the way through for a non-answer.
- A top-level answer past the rule is not read: a tagged person a business day or more later, or an open ask
  answered more than two hours later. A 1:1 DM's top level is read whole, as the conversation; a group DM's
  goes through the rule, like a channel's.
- Whether a picture is a CHART is judgement; that it is a picture is checked.

Code: `src/outbound/slack/priorAsk.ts` (judgement), `src/cli/commands/slack/draftPriorAsk.ts` (record),
`src/cli/commands/slack/releaseFreshnessGate.ts` (release), `src/live/slack/priorAskRead.ts` (read),
`src/outbound/slack/topLevelAnswer.ts` (the top-level rule).
