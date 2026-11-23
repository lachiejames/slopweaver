# The write path (`slack`)

Part of [Security & trust](../security.md).

Slopweaver is not read-only. It can post to Slack, and a reviewer should assume the strongest form of that:

- **It can post as the bot, or as you.** `slack post --as bot` posts a rendered card under a bot identity;
  `--as me` posts under **your own Slack user**, via a user token with write scopes. There is no
  technical difference between that and you typing the message yourself.
- **A message in your name can be parked for you to read first.** `slack draft record` runs the `--as me`
  preparation (the form, its bounds and voice rules, bare references, mentions) and parks the message under
  `$SLOPWEAVER_HOME`, posting nothing; the duplicate-send check and the door run only at release.
  `slack post --as me --draft <id> --approve <digest>` releases a top-level one and `slack reply` a thread
  one (`record --thread-ts`), each refusing the other's rows, and only when `--approve` is the draft's
  digest, which binds the destination, the thread, the exact bytes and, whenever the token's identity read
  names a user, the posting identity; a re-preparation that produces anything else is refused rather than
  posted. `record --as bot` parks a bot card the same way, released only by `slack post --as bot --draft`
  through the whole bot card lane; a finding shared top-level in a channel is parked that way, since the owner's
  name goes on one only where the bot cannot post (the owner's ruling). A row parks only with its receipts — a link
  or file it carries, else a stated `--self-evident` or `--tried` — recorded beside the digest, not in it: they
  describe what the bytes bring, which the digest already binds ([receipts](../../skills/slack/reference/receipts.md)).
  A held row carrying the owner's recorded yes cannot be held for "not the owner's yes" without a newer word of the owner's
  on its card.
- **It can edit and delete — but only its own messages.** `slack edit` and `slack delete` refuse anything
  slopweaver did not post, enforced by an ownership check that does a live read-back before mutating.
  Someone else's message cannot be edited or deleted through these verbs. `slack delete` alone also takes a
  bare line whose `bot_id` is this token's own and which carries no metadata at all, because a human typed
  that exact `ts`; `slack edit` and the automatic delete below stay metadata-bound. One delete happens inside a
  turn: a correction turn deletes the bot's own earlier answer it supersedes, and only on two independent
  declarations (the composer names the answer in `supersedes`, and a different reviewing session warrants
  the delete), only for an answer this install's completion ledger proves it posted in the same thread, and
  only after the same live read-back.
- **A live turn edits its own card repeatedly.** `turn status` posts one progress card per turn and then
  EDITS it as the turn moves, so a single run rewrites one message many times rather than posting many.
  There is exactly one progress shape in `src/outbound` (`assistant/todoBlock.ts`); the `slack progress`
  verb family that drew a second one was deleted.
- **It can reshape the workspace, and those acts are harder to undo than a message.** `slack channel create`
  mints a real channel, names it, describes it and puts people in it; Slack offers no delete for a channel,
  so `slack channel archive` is the only retraction and the name stays taken forever. `slack dm open` opens
  a DM or group DM with named people — reversible for nobody, though it sends nothing and Slack resolves one
  user set to one conversation, so a repeat creates nothing. `slack canvas create` writes a document that,
  when `--channel` is given, everyone in that conversation can read the moment it exists; `canvas replace`
  rewrites a whole document and `canvas delete` removes one. A reviewer should read these as the loudest
  writes in this file after `--as me`: each refuses more before the network than a send does, each is
  at-most-once where a repeat would duplicate, and each is ledgered by destination and size, never by prose.
  Which scope each lane needs and what each refuses: `skills/slack/reference/workspace-shape.md`.
- **It can set the owner's own status and presence.** `slack status set|clear` writes the owner's profile status (text, emoji,
  expiry) and `slack status presence` sets a manual away or back to auto, on the USER token only and only with
  `users.profile:write` / `users:write` granted. The text is the owner's words shown workspace-wide, so it passes the
  voice gate; the door records the write by shape, never the text. A manual away does NOT expire with the
  status — it stays until `--to auto`. Details: `skills/slack/reference/status.md`.
- **Nothing answers without an explicit invocation.** There is no scheduler and no unattended executor.
  Every answer is one command you ran: `slopweaver listen` only captures the addressed message, a visible
  Claude Code or Codex session composes the reply, and `turn answer` is the command that posts it. The one
  sessionless mode, `listen --follow --queue <path>`, may acknowledge and durably queue addresses; it never
  composes or posts an answer.
  See [below](slack-inbound.md).
- **One bot reply nobody asked for: a witness.** In a thread where a person tagged a peer bot the profile
  names, a visible worker booted by `witness dispatch` may post ONE `slack reply --as bot` carrying the
  `witness` form, which refuses a reply without one to four `https` proof links and a one-sentence finding
  (`src/outbound/artifact/witness.ts`), keyed `witness:<channel>:<messageTs>` so a retry is a no-op. Silence
  is the default ending; the owner approved the pattern ([witness](../../skills/witness/SKILL.md)).
- **`--dry-run` renders without sending**, and is the recommended way to see exactly what would be posted.
