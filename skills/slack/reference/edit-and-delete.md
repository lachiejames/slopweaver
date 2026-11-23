# Editing or deleting a message

What each lane's `edit`/`delete` takes, and why the human lane runs no ownership check at all.

`slopweaver slack edit --channel <id> --ts <ts> ...` and `slopweaver slack delete --channel <id> --ts <ts>`
mutate a message already on the wire. Like `post`/`reply`, `--as` picks the lane — but here it's **optional**
and defaults to `bot`, because both verbs existed before `--as me` did and every call that has never named it
must keep working exactly as before.

|                 | `--as bot` (or no `--as`)                                              | `--as me`                                      |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| what edit takes | `--form` of the target's own kind: card, `answer`, `checklist`, `poll` | `--form` (one single-message drip) or `--body` |
| ownership check | yes — only edits its own messages                                      | **none** — see below                           |
| token           | `xoxb` bot token                                                       | `xoxp` **user** token                          |

**`delete --as bot` also takes a bare line this bot posted.** A message whose `bot_id` is this token's own but
which carries NO metadata at all is deleted rather than refused; a human's, another app's, a foreign metadata
kind and an unknown renderer still refuse. `edit` is untouched, because it re-renders and a bare line has no
shape to re-render, and so is a correction turn's automatic delete, which only ever removes an answer. MEASURED: the stranded lane's re-dispatch notice went out bare,
`slack delete` refused it as carrying no metadata, and it stood after the owner
asked twice for it gone. That notice now carries `slopweaver_notice_v1` (`src/outbound/slack/noticeMetadata.ts`).

**A delete is journalled into the draft register, in both lanes.** Once a delete is confirmed (or the provider
reports the message already gone), every draft row released at that channel and ts gets a `deleted` event
(`src/outbound/slack/draftDeletion.ts`), so [finding-followups](finding-followups.md) stops owing it a chase. The
bot lane journals a target that was ALREADY absent before its read-back too, and still exits 1: re-running
`slack delete` on a message removed before this journal existed is how its row is healed. A dry run, a refusal or
an unconfirmed delete journals nothing; a journal that fails prints to stderr and never changes the delete's exit.
MEASURED: a draft was deleted and reposted, and
`finding-followups` still listed it owed 228h later.

**Why the human lane runs no ownership check.** The bot-card lane's guard (`messageOwnership`) exists because
`chat.update`/`chat.delete` with a BOT token can technically reach any message the app can see, so this
program checks the target carries its own metadata before touching it. A USER token has no such reach:
`chat.update`/`chat.delete` on a `xoxp` token only ever succeeds against a message THAT SAME IDENTITY posted
— Slack refuses anything else at the platform level. So there is no ownership _decision_ left for this code
to make on that lane; the token itself is the boundary. This is why the bot routinely fixing up its own
`--as me` messages (a broken link, a formatting slip) is meant to work, and why it needed no metadata gate to
enable it.

**`edit --as me` takes one message, never a drip.** `post --as me` sends a SEQUENCE and `edit` replaces a
SINGLE `ts`, so a multi-message `kind: "drip"` form is refused outright — "which message of N do you edit?"
has no answer. Pass a single-message drip (`{"kind":"drip","messages":[{ "runs": [...] }]}`, one entry) or
use `--body -` for the same raw escape hatch `post --as me` has. No `--shape`, because there is nothing to
sequence, and no `--allow-unresolved-owner` — this lane has no digest owner field to degrade. An edit re-publishes
its tags, so every person it tags is read off Slack's live roster first and a departed one refuses it, exactly as
at post time ([mentions](mentions.md)).

```bash
slopweaver slack edit --channel <id> --ts <ts> --as me --body - --dry-run <<'MSG'
fixed the broken link above ↑
MSG
```

`delete --as me` takes no extra flags at all — just `--channel`/`--ts`, same as the bot lane.

**An edit is judged for a PR-led opening, exactly as a send is** (never lead with the
PR). `edit --as me` and a card or poll `edit --as bot` refuse a message whose first block opens on a pull request or asks
a teammate to approve, review, merge or land a fix (`src/outbound/slack/draftPrLead.ts`), with no hatch: reword it
to open on the evidence, the pull request below. The owner's own bot DM is exempt once a bot-token read proves the owner its
other member (a message already there proves nothing), and an answer card is not judged,
because the person who tagged the bot chose its subject.

## `edit --as bot` re-renders an ANSWER card too, in its own shape

A `kind: "answer"` form is dispatched to its own path rather than coerced into an `update` one. That is the
whole point: an answer carries `lead`/`index`/`body` **and** a `grounding` block, and its renderer appends
the evidence trail and provenance footer that the update card has no field for. Routing one through the
update renderer would not be an edit, it would be a silent replacement with a smaller shape — the four
evidence sections and the footer would vanish from a message people had already read.

**The ask identity is inherited, never supplied.** An answer card records which ask it answers, and a
re-render is still the answer to that same question, so the edit reads `askIdentity` back off the message it
is editing. A caller-supplied one would be a way to re-point an existing answer at a different question; a
freshly minted one would detach the message from the ask ledger. A target carrying no readable `askIdentity`
is refused, and nothing is changed.

Everything else is the same as a card edit: the 4-column table ceiling, the above-fold and body-prose caps,
the voice rules, the mention resolution over BOTH regions, and the attached file ids re-sent so `chat.update`
does not detach the media.

MEASURED, which is why this exists: `slack delete` had been widened to accept
`slopweaver_assistant_answer_v2` and the edit path never was, so the bot could retract its own public answer
and could not correct one. A card said it could not read a system when it
could, and the fix for the CLAIM was one verb away while the fix for the MESSAGE was unreachable.

## Every kind delete takes, edit takes from its own form

Both verbs read their target against ONE event-type table (`src/cli/commands/slack/lifecycleEventTypes.ts`), so
they cannot disagree again about what is the bot's own. Edit then sorts the target by kind and re-draws it only by
that kind's renderer; a form of another kind is refused naming the right one (exit 2), never coerced. The renderer
the message names is a second witness: one whose event type says one kind and whose renderer says another is
refused (exit 2), because which renderer re-draws it cannot be told; where a profile reuses one event type for two
kinds, the renderer settles which, and a renderer that does not is refused the same way.

- **A turn checklist** takes `{"kind":"checklist","task":"…","modelId":"…","steps":[{"id","title","state",…}]}`,
  held to `turn status`'s own caps, and is re-drawn by the turn frame through `updateTurn`. Its `turnId` is
  inherited off the message, as an answer's `askIdentity` is.
- **A poll** takes the `kind: "poll"` form `slack poll` posts. Its `pollId` is inherited, and its local record must
  name this exact message. **The ballot is frozen**: a vote is a reaction bound to an emoji position, so a
  relabelled, reordered, added or dropped option is refused (post a new poll and delete this one). The question,
  reason and pings move, the record follows, and the opening is judged for a PR lead as the post was.
- **A progress message or a notice** has no renderer: edit refuses it by name and routes to `slack delete`.
