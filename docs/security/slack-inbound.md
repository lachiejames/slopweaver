# The inbound path (`listen`)

Part of [Security & trust](../security.md).

`slopweaver listen` is the one verb that reacts to something instead of being told to do something, so its
boundary is stated separately.

- **Nothing listens on a port.** It uses Slack's Socket Mode: an OUTBOUND websocket from your machine to
  Slack. No inbound connection is accepted, no port is opened, and no public URL exists — which is why
  Socket Mode was chosen over the HTTP Events API.
- **It wakes only when addressed, and address means an explicit tag on both surfaces.** In a channel that
  arrives as an `app_mention`; in a 1:1 DM Slack sends no `app_mention` at all, so the same tag is found in
  the `message.im` text. An untagged DM is refused at the parse, so it produces no reaction, no checklist and
  no queue entry (the owner's ruling: the DM is where the owner drafts messages that post as the owner, and a plain
  `message.im` counted as address would start a turn on each draft). It
  refuses ordinary channel messages, group DMs, message subtypes and this install's own messages, and never
  joins a conversation uninvited. Another bot's tag, told apart by its own `bot_id`, reaches the responder
  whitelist exactly like a human's; while this install's own `bot_id` is unknown, or an event carries only an
  `app_id`, every bot-authored event is refused (`src/live/listen/mention.ts`). The one wider address is
  opt-in per channel (`listen --thread-replies`): a reply whose thread root this install's own bot user wrote.
- **Stated precisely: the app's SUBSCRIPTION is wider than what the listener acts on.** Slack may deliver
  other `message.*` events down the open socket, and the listener ADDRESSES only `app_mention` and a
  `message.im` that tags the bot. The one other thing it keeps is a WITNESS line, below; every other message
  is discarded and not stored. Narrowing the live app subscription is a separate configuration change.
- **It WITNESSES a peer bot's threads, silently, when the profile names one.** With
  `slackBot.witnessBotHandles` set and only under `--follow`, a channel message tagging that bot activates its
  thread, and each later message there — the peer bot's own included — is written to the queue and stdout as
  a `{"kind":"witness"}` line (`src/live/listen/witnessTap.ts`). It posts nothing, reacts to nothing and
  starts no turn; per-thread state lives in `$SLOPWEAVER_HOME/live/slack/witness-state.json`, lapsing 14
  days after a thread's last message, at most 40 lines per thread per day. Scope still bounds it. What
  happens to a line, and the one reply it may end in: [the witness skill](../../skills/witness/SKILL.md).
- **It witnesses its OWN threads the same way, with no profile entry,** and a later message there may become
  an ask nobody tagged. A person's live tag of this bot activates the thread — a peer bot's never does;
  `witness help` (run by the visible loop, never the listener) turns one later line into an ordinary capture
  — reaction, checklist, turn — only after the SAME responder whitelist, both ignore registries, the
  high-stakes gate, a check that no ask is live in the thread, a per-thread daily cap, and a fresh Slack read
  of the thread proving a responder tagged the bot before that message and that its author is the one named
  (`src/live/witness/help.ts`, `src/live/witness/helpThread.ts`). A non-responder's message can never start one.
- **An address DOES cause a post — an acknowledgement, never an answer.** On every captured address `listen`
  posts a checklist to the thread and sets a reaction, before any session is involved; an address from
  someone off the whitelist gets the fixed gate line instead (with a populated list, a wait for the owner to
  approve that one ask, tagging the owner when `profile.json` holds a valid Slack user id for the owner and saying so without a tag when it does not; with an empty or unreadable one, that nobody is being answered), sent through
  the door best-effort: a refused
  or failed post is logged and the address stays refused (`src/cli/commands/listen/responderRefusal.ts`). An
  address outside the listener's scope (`--channels`, `--dm-only`; `src/live/listen/scope.ts`) is dropped
  before either and gets nothing. It runs no model and composes nothing; the post says only that the tag was
  seen. This is deliberate — the bot is meant to answer a tag, so "I saw you" arriving immediately is the
  wanted behaviour and not a leak.

  Stated plainly because an earlier version of this file claimed the opposite ("it posts nothing"), which
  was written from the doctrine rather than from the code and was false the day it was written. What follows
  from it: an inbound address from anyone reaching a running listener produces a write to your workspace. The
  gate on WHO may command the bot decides which write — see [§ "Who may command the bot"](slack-command-boundary.md).

  The ANSWER is a deliberate, later step, driven by hand inside a visible Claude
  Code session: `turn brief` reads the mention and names what the context can reach (no model, no door), the
  session composes a reply, and `turn answer` posts it through the admit door and the same at-most-once
  posting client every other write uses. A redelivered event, or a second event naming the same message, is
  still dropped rather than answered twice — the listener dedupes on the message, not the event id.

- **A turn still retrieves through the OWNER's lens, whoever tagged it.** Resolving a Slack asker to a
  corpus identity needs the exact-match roster, and a fuzzy name match would be worse than the restriction —
  so the evidence a non-owner's tag pulls in reflects the owner's corpus minus its private lane, which the
  store's `bot` role cannot read at all (`src/store/policies.ts`). That happens before any
  withhold judgement runs, which is why a released draft still deserves the scrutiny a manual post would. What
  the draft may then SAY is judged by the composing session and its reviewer, not by the withhold gate: share
  only what the owner, compliance in mind, would show every reader of the thread
  ([what-the-reply-may-share](../../skills/loop-bot/reference/what-the-reply-may-share.md)).
- **The reply is sent only to whoever the responder whitelist already trusts to command the bot — every
  other tag's draft is withheld.** The shipped judgement (`src/admit/withhold.ts`) is the only one this
  plugin ships, wired in unconditionally: it sends when the asker's Slack user id is on `responders.json` —
  the SAME list that decides who may address the bot at all — and withholds everyone else, with no owner
  carve-out. An owner not on the list is withheld exactly like anyone else. A withheld draft is queued under
  `$SLOPWEAVER_HOME/queue/withheld.jsonl` with its reason; the owner reads it with `slopweaver queue
list/show` and releases it with `slopweaver queue release <id>`, the break-glass, recorded as an override
  rather than an ordinary send. So a colleague who is admitted but tags the bot in a shared channel still
  gets nothing posted automatically unless they are themselves on `responders.json` — the draft waits for
  whoever can act on it. See [§ "Withholding a reply"](withholding-a-reply.md) below.
- **A turn may act, but its REPLY is closed.** The session running a turn has every tool it has anywhere —
  it may run a verb, read a live system or raise an asked-for pull request, each through its own door. What reaches the
  thread is one typed form: a posted answer or a withheld draft. On a public ask the answer goes first:
  `github stack push` refuses a push from the ask's dispatched worker while the ask is still unanswered
  (`src/cli/commands/github/answerFirstGate.ts`, a tripwire that sees only a worker that announced itself).
- **It stops when you stop it.** It is a foreground process in your terminal; Ctrl-C ends it. Nothing
  restarts it, and it is not installed as a service.
