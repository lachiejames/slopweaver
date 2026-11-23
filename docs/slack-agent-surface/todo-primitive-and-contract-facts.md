# 5. The native todo primitive exists, and it is not free

Part of [The Slack agent surface](../slack-agent-surface.md).

`chat.appendStream` takes `chunks`, and one chunk type is `task_update`. Measured: sending

```json
{ "type": "task_update", "id": "t2", "title": "Probe the assistant methods", "status": "in_progress", "details": "…" }
```

reads back as a **`task_card` block** with `block_id: "task-t2"`, `task_id`, `title`, `status`, and `details`
widened from the plain string into a nested `rich_text` block. Re-sending under the same `id` **updates that
card in place** — one chunk per advance, no bookkeeping. Four states: `pending`, `in_progress`, `complete`,
`error`. `task_display_mode` on `chat.startStream` selects `timeline` (default), `plan` or `dense`.

Four measured costs decide when to use it:

1. **A stream has a mode, and it is sticky.** After a `task_update` chunk, appending `markdown_text` to the
   same stream fails with **`streaming_mode_mismatch`**. So a native task card **cannot share its message with
   the turn's prose answer**. The reference's hand-rolled shape can, which is why the reference uses it.
2. **An open stream cannot be deleted.** `chat.delete` on a live stream returns **`cant_delete_message`**; it
   becomes deletable only after `chat.stopStream`. A turn that dies mid-stream therefore leaves a message that
   cannot be cleaned up until someone stops the stream. `assistant.threads.setStatus` has no such hazard —
   it leaves no message at all, which is the brief's stated reason for wanting it.
3. **`stopStream` rewrites every unfinished task to `error`.** This is the sharpest one, and it was found by
   accident: three cards were sent as `complete` / `complete` / `pending`, and the stopped message read back
   as `complete` / `complete` / **`error`**. Isolated and confirmed — sending `pending`, `in_progress` and
   `complete`, then stopping, reads back as `error`, `error`, `complete`. So a native checklist **cannot show
   remaining work once the turn ends**: everything not finished renders as a failure. A turn that plans five
   steps and completes three will look like it broke twice.
4. **An in-flight streamed message has no `blocks` at all.** Read back mid-stream it carries a
   `streaming_state` field and no `blocks` array; the blocks materialise only on `stopStream`. Anything that
   inspects its own posted message — a duplicate gate, a lifecycle sweep, an edit that re-renders — cannot
   read a live stream.

Both renderings are implemented from one step list (`renderTodoBlocks` and `todoTaskChunks`) because the recon
proved both work. The reference-shaped static rendering is the production default. Native cards are useful
as a transport capability, but not for a production checklist whose first frame must be recognisably owned
and deletable after a process death.

**Do not propose native task cards as a progress surface again.** The owner rejected them on sight twice on
sight twice, in independent sittings, as looking awful, and cost 3 means they cannot work regardless of
taste: a checklist that cannot show remaining work is not a progress list. A turn's progress is its one
edited-in-place card ([the live card](../../skills/loop/reference/live-card.md)). If a flat chunk list is ever
needed, the shape is `chunks: [{type:"task_update", id, title, status, details?}]`; nesting under a
`task_update` key earns `markdown_text_or_chunks_required`.

## 5.1 Why three older checklists cannot be repaired

Measured: frozen checklists authored by the app's bot lacked Slopweaver ownership metadata. A non-admin user
had no Delete action in Slack's standard message menu. That is consistent with Slack distinguishing
user-authored messages and app ownership; bot identity alone does not establish feature ownership.

The bot token could ask Slack to delete its own message, but Slopweaver's sanctioned lifecycle correctly
refuses metadata-free messages: bot identity alone does not prove which feature owns them. Raw API use or a
weakened guard would bypass that boundary. With no workspace-admin involvement in scope, those three messages
are therefore a permanent dated exception. New static checklists carry `slack-turn-v1` /
`slopweaver_turn_v1` metadata from the initial post and are deletable through `slopweaver slack delete`.

## 6. Other contract facts worth not re-deriving

- `chat.startStream` **requires `thread_ts`** — the SDK refuses without it (`invalid_arguments`). Streaming is
  thread-only; there is no top-level streamed message.
- Streaming to a **channel** additionally requires `recipient_user_id` and `recipient_team_id`
  (`missing_recipient_user_id` / `missing_recipient_team_id`); a DM does not.
- `markdown_text` is capped at **12,000 characters** per call.
- `chat.stopStream` accepts `blocks` "rendered at the bottom of the finalized message" — up to 50, separate
  from the 50-chunk limit. That is where the provenance footer goes on a streamed turn, and it is measured
  working: our probe's `context` footer came back as the final block.
- `assistant.threads.setStatus` has a **2-minute timeout**; a longer turn must re-assert or the indicator
  vanishes, which looks exactly like a dead turn.
- `username` **does** survive on `chat.startStream` through to the finalised message.

## 7. What is NOT proven here

Stated plainly, because this note's value is that it can be trusted.

- **No screenshot.** This run had no interactive Slack client, so the _appearance_ of any of it is unverified.
  Every claim [above](../slack-agent-surface.md) is about the API contract and the stored payload, which is what a renderer is written
  against — but "it looks right" is not among them. A real turn rendered by these functions was left in the
  owner's DM instead, so the appearance can be judged without re-running anything.
- **Which name the sidebar and the message header actually show.** `username` and `bot_profile.name` are
  measurably independent fields ([§ 2](measured-rendering-and-identities.md#2-the-reference-agent-does-not-render-through-the-agent-surface)), but which surface reads which needs eyes on a client. The reference
  thread is evidence that the per-message form is what appears in a message header, since that is where its
  bracketed per-task name is visible to the owner — but that is the owner's observation, not this run's measurement.
- **Whether `assistant.threads.setStatus` visibly paints** in a thread that is not an agent-view thread. The
  API accepted it (`ok: true`) in a plain DM. An API read cannot prove a client render.
- **The paid-plan gate.** The docs say "Developing and using some AI features require a paid plan, despite
  being visible in the app settings on any plan"
  ([reference](https://docs.slack.dev/ai/developing-agents)). The workspace probed here is on a paid tier and
  everything [above](../slack-agent-surface.md) returned `ok`, so nothing was blocked in practice — but the gate is documented, it is not
  discoverable from the app settings ("despite being visible in the app settings on any plan"), and it would
  bite a workspace on a free plan. Do not describe the AI features as ungated.
