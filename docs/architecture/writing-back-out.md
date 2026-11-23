# Writing back out

Part of [Architecture](../architecture.md).

- **the admit door** (`src/admit/`): the trust spine every side-effecting action is routed through. A pure
  decision engine runs an injected gate list and returns `pass` / `warn` / `hold` (a WITHHELD reply is a
  `warn` whose override token is the break-glass, not a fourth status); `ledger.ts` records the
  decision and `effects.ts` performs the effect **only on `pass`**. Warn-first and never silent: a `warn` is
  a structured, self-correctable finding the caller can re-issue past with `$SLOPWEAVER_DOOR_OVERRIDE=<token>`,
  while a `hold` is the irreversible-harm class and is not waivable that way. `DEFAULT_GATES` is
  deliberately **empty**, and each caller composes its own list: the Slack verbs that author prose (post,
  reply, drip, edit, poll, canvas, channel create) and the bot's answer and thread title add the
  voice-profile gate (`voiceProfileGate.ts`), the operator's exact rules for that lane's actor, which
  WARNS with the override `voice.profile:v1`; the bot's answer also adds the answer-quality gate. A turn's
  own working frames and notices, the Linear, GitHub and Notion prose writes, and every Gmail write, pass no content
  gate at the door, so there it guarantees _routing and audit_, not content policy; those provider writes run their
  checks before the door, and the outbound privacy check and the dead-host refusal at their write transports
  (Gmail's in its auth client's `fetch`, `src/live/gmail/guardedFetch.ts`). A live, unoverridden refusal by the above-the-fold gate, which runs before the
  door on bot cards and on those provider writes, appends a `refused` row to the same ledger, best effort:
  a failed write is logged and the refusal still stands. The one policy the decision itself owns is the
  approval claim: a request whose `meta.requiresApproval` is true and whose gate list carries no `approvalGate()`
  (`src/admit/approval.ts`) is `hold`, so the label cannot outrun the check. `dev door-coverage` is the
  ratchet that keeps the routing half true: it scans for direct side-effecting primitives and fails the
  build on any seam that is neither door-routed nor an acknowledged local-state write.
- **outbound** (`src/outbound/`): the Slack write half, split three ways so a second platform can reuse the
  parts that generalise. An **artifact** layer holds the Zod-validated form (headline + detail blocks +
  inline runs, with citations as structured objects); a **renderer** turns that into Slack `rich_text`
  (never mrkdwn — markdown is inert inside `rich_text`, which deletes the escaping bug class that breaks
  mentions); and a **lifecycle** layer owns post / reply / edit / delete. A live turn's progress card
  is a checklist it edits in place (`assistant/todoBlock.ts`).
  The rule the split enforces: share the DATA and the POLICY, never the RENDERING or the TRANSPORT.
  Ownership is checked by live read-back, so edit and delete can only touch messages slopweaver posted.
  A fourth group sits beside those three and is deliberately NOT a lifecycle: the **workspace-shape**
  verbs (`slack channel`, `slack dm`, `slack canvas`) change what the workspace contains rather than sending
  anything, so they carry no artifact form and no renderer at all — their whole surface is a name, a set of
  people or a markdown document. What they inherit instead is the transport's at-most-once posture, because
  each one's retraction is weaker than a delete.
- **listen → turn** (`src/live/`): the one path that starts outside the machine — but the path stops at
  `listen`, by design. `listen` holds an outbound Socket Mode connection and accepts an explicit
  channel `app_mention`, a 1:1 DM whose text tags the bot, and — in a channel `--thread-replies` names — a
  reply whose thread ROOT this install's own bot user wrote. It refuses every other channel message, group
  DMs and its own messages. It PRINTS the address, posts a capture-time acknowledgement to the thread,
  and stops. No model runs on this path and no answer is composed. What happens next is driven by hand,
  inside the visible agent session the bot loop runs in, and the write is checked at every step of it, in
  order: `turn brief` reads the address and names what this context can reach (no model, no door);
  `turn dispatch` finds the ask's progress card on record, or posts one, and tries to move it to the
  dispatched frame before any worker starts; a post that cannot land refuses the dispatch
  (`src/cli/commands/turn/ensureCard.ts`); the worker
  investigates with every tool it has and composes a typed form; `turn review` runs the door's own
  deterministic gates, voice rules first, before it spends a reviewer (`src/live/turn/answerPreflight.ts`),
  and a different session's verdict binds to the answer's bytes; `turn answer` first refuses outright a brief
  whose asker is no longer on the SAME `responders.json` that decided who may address the bot at all — no
  owner carve-out — then refuses a payload Slack's wire guard would reject (`src/live/turn/answerSendable.ts`),
  then offers the answer to the admit door, which runs the **withhold** judgement (`src/admit/withhold.ts`),
  the deterministic gates again, and the verdict check (`src/admit/answerQualityGate.ts`). Any other warn
  goes back to the same worker to correct and offer again, with nothing sent. Each of those door warns, the
  withhold included, is waived per action by its token in `SLOPWEAVER_DOOR_OVERRIDE`, and the door records
  every waiver (`src/admit/door.ts`); the entrance refusal has no such token. The worker reads through the
  OWNER's access minus the private lane the store's `bot` role is denied (an owner ruling,
  `src/store/policies.ts`), no matter who tagged it, and `turn answer` loads no corpus of its own. Two controls
  follow. Who the answer is SENT to: the entrance refusal, and the withhold — the only one shipped and wired in
  unconditionally — checking that list again at the door and queueing a reply it refuses for the owner to
  release by hand. The journalled `responder-allow-open` grant (`slopweaver hatch open`) opens every one of those checks at once.
  And who may SEE each fact in it: every reader of the thread, judged by the worker and its reviewer under the
  standing rule `turn brief` prints, with a fact some reader cannot already reach waiting on the owner
  ([what-the-reply-may-share](../../skills/loop-bot/reference/what-the-reply-may-share.md)). See
  [slack-agent-surface/tag-to-answer.md](../slack-agent-surface/tag-to-answer.md#what-it-does-not-do) and [security/withholding-a-reply.md](../security/withholding-a-reply.md) § "Withholding a reply".
