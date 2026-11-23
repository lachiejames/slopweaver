# How a tag becomes an answer

Part of [The Slack agent surface](../slack-agent-surface.md).

`slopweaver listen` opens a Socket Mode connection and holds it. The connection is outbound: no port is
opened, no public URL exists, and nothing inbound is accepted. **It only captures the mention and prints (or
queues) it — it runs no model, composes nothing, and posts no answer.** Turning that capture into an answer
is the visible session's job: `slopweaver turn brief` names what this context can reach, `slopweaver turn
dispatch` runs the tier the session judged, the session investigates and composes, and `slopweaver turn
answer` checks what it wrote and posts it. `skills/loop/SKILL.md` is that loop, spelled out in full.

In the thread the tag was posted in, that produces:

1. a **working message**, posted at capture so the tag is visibly received — and checked again by
   `turn dispatch`, which posts one if none is on record or Slack reports it gone, and refuses to start a
   worker when that post fails (`src/cli/commands/turn/ensureCard.ts`);
2. a **checklist that advances in place** — dispatch tries to move it off its capture-time frame, and the
   worker's own `turn status` ticks it from there, each an edit of the same message;
3. the **answer**, posted by `turn answer`, which then deletes the working message (kept if another open ask
   may still share it), with citations to what the session actually read or ran;
4. a **coverage statement** — what it could not read, so a thin answer reads as thin rather than as
   confident.

The checklist is an ordinary metadata-bearing message from its first frame. Each tick replaces that same
message with `chat.update`; the static shape gives up Slack's collapsible native plan widget so a frozen
checklist remains recognisable to the sanctioned edit/delete lifecycle.

## A tag on both surfaces, plus a reply under the bot's own post

The listener accepts an explicit channel `app_mention`, and a `message.im` in a 1:1 DM **that tags the bot**.
It refuses ordinary channel messages, group DMs, message subtypes and its own messages.

There is a third address: **a reply whose thread root is one of the bot's
own posts**, so a scheduled alerts post answers the reader who replies under it without anyone opening
Datadog. It is bounded on every side. The root's author must equal this install's own bot user id
(`parent_user_id`, an exact id match — never a display name); nothing top-level wakes it; the bot never
answers itself; and it is opt-in per channel with `listen --thread-replies <C1,…>`, empty by default, so
switching one channel on is the whole unit of rollout. One thread wakes at most four replies a day
(`THREAD_REPLY_DAILY_CAP`, `src/live/listen/threadReply.ts`). Recovery does not reach these: a missed reply
carries no tag, so `listen recover` excludes it as `not-addressed` — a no-op by design, exactly as rule 2
says a tag arriving with no visible session is.

**The DM needs a tag too**: the owner's DM with the bot is
where DRAFT messages to send as the owner get composed, and an untagged DM that wakes a turn puts an hourglass
react and a working card on the owner's own words. Tagging is the one address rule on both surfaces, and an untagged DM is refused at the parse
(`src/live/listen/mention.ts`) rather than captured and later withdrawn, so it leaves no artifact at all.

The app's event subscription remains wider than what the listener acts on, so Slack may deliver other
`message.*` events to the open socket. The listener discards them and stores nothing — MEASURED:
thousands of channel and group `message` events had already arrived and been refused at the
parse before a reply was ever an address (`grep -ch "not a direct message" "$SLOPWEAVER_HOME"/live/listener/*.err`).
That is the point rather than a gap: the predicate in `src/live/listen/mention.ts` is the one place the rule
lives, so a subscription can never widen what gets answered.

## What it does not do

- **It does not reply outside the closed form.** A turn may act with every tool its session has — run a
  verb, read a live system, raise an asked-for pull request — but its reply leaves only as a typed form through
  `turn answer` and the admit door. On a public ask the answer goes out before any pull request:
  `github stack push` refuses a push from the ask's dispatched worker while the ask is still unanswered — a
  tripwire that sees only a worker that announced itself through `turn resume` or `turn status`
  (`src/cli/commands/github/answerFirstGate.ts`).
- **It does not decline a question because of what the answer is ABOUT.** A question whose honest answer
  ranks, compares or names colleagues is answered, correctly and with citations — the onus is on the human for asking
  questions in public that rank people, and the bot's only duty is the most accurate, citation-backed answer to
  the question asked. Tact is the asker's, never the bot's, and the functionality
  is never reduced or revoked. Accuracy is untouched by it: a ranking the records do not support is still a
  wrong answer, and still not one to post. See [security/withholding-a-reply.md](../security/withholding-a-reply.md) § "Withholding a reply" and
  [doctrine-rationale/accurate-answer.md](../doctrine-rationale/accurate-answer.md) § "The bot answers any question accurately".
- **It answers through the OWNER's lens, whoever tagged it.** Retrieval applies the owner's identity and
  scoping to every asker, because resolving a Slack asker to a corpus identity needs the roster — this repo's
  identity rule is exact-match only, and a fuzzy name match would be worse than the honest restriction. The
  control is on who it SENDS to: a reply posts only when the asker is on `responders.json` (or the
  journalled `responder-allow-open` grant is open for that session). `turn answer` refuses a brief whose asker is off it,
  and the door's withhold (`src/admit/withhold.ts`) checks again and queues a draft it refuses for the owner to
  release, unless its `SLOPWEAVER_DOOR_OVERRIDE` token waives it. Neither gate narrows what a posted answer may
  say: a turn runs as the store's `bot` role, denied every private-lane row (`src/store/policies.ts`), and the composing session and its reviewer judge who may SEE each remaining fact —
  every reader of the thread, not only the asker — under the standing rule `turn brief` prints as `WHAT THE
REPLY MAY SHARE` ([what-the-reply-may-share](../../skills/loop-bot/reference/what-the-reply-may-share.md)).
- **Retrieval is keyword-only, everywhere, not just in a turn.** There is no
  pgvector, embeddings, re-ranking or semantic search — there is no semantic leg to switch on and no
  parameter that could. Selection is Postgres full text plus `--contains`/`--like` substring over the store.
  The coverage statement reports the prompt cap only.
