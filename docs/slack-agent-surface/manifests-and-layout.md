# The manifests

Part of [The Slack agent surface](../slack-agent-surface.md).

Three tiers ship under `templates/`, and **the difference between them is a capability-versus-risk trade the
user makes, not one this repo makes for them.** Each file states what it enables and what it costs, in the file
itself; [`templates/README.md`](../../templates/README.md) is the same table with the reasoning.

| Tier                     | File                               | Enables                                                             | Risk                                                                                        |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **STANDARD** _(default)_ | `slack-app-manifest.full.json`     | Ingest, posting as the bot **and as you**, search, answering a tag. | **The least secure of the three.** Write scopes on your **own** user token.                 |
| **MINIMAL** _(safer)_    | `slack-app-manifest.readonly.json` | Ingest only.                                                        | The lowest on offer — no bot user, no writes, so it can never post and can never be tagged. |
| **STANDARD + AGENTS**    | `slack-app-manifest.agent.json`    | STANDARD, plus Slack's Agents feature.                              | STANDARD's, plus a cost that **cannot be undone** — see below.                              |

**STANDARD is recommended, not imposed.** The tagged bot does not exist without a bot user and Socket Mode, so
STANDARD is what makes this surface whole — and it is also the most permissive thing here, which is why its own
description says it is the least secure and points at MINIMAL in the same breath. Every ingest verb, `derive`,
`distil`, `store read` and `store cite` behave identically on MINIMAL; what MINIMAL gives up is posting and being tagged.

Both STANDARD tiers carry the live app's scope set, verified against it. STANDARD is the live set minus the one
scope the Agents feature adds; STANDARD + AGENTS is the live set exactly. A unit test pins the scopes whose
absence is destructive — the real-time-search family on both tokens, and `metadata.message:read` on the bot —
so a hand edit cannot quietly drop them again.

## Two things to do before pasting one

**Populate the fields.** Every tier ships `{{APP_NAME}}` in `display_information.name`, and the STANDARD tiers
also ship `{{BOT_DISPLAY_NAME}}` in `features.bot_user.display_name`. They are placeholders on purpose: a
committed template carrying a real name renames whatever app it is pasted into, in every channel that app has
ever posted in.

**Check it is a first install.** A Slack manifest is applied whole, so pasting one over an app that already
exists renames it and **revokes every scope the pasted file does not list**. To change a live app, export that
app's own manifest from <https://api.slack.com/apps> → your app → **App Manifest**, and edit that copy.

**Drift is not yet machine-checked, and that is a named gap.** The live scope set is readable in one request:
the `x-oauth-scopes` response header on an `auth.test` call with each token. A check comparing the committed
templates against that belongs beside the other gates, but it needs live tokens — so it cannot be a CI lint
lane, and it is a verb rather than a gate. It is not in this change. Until it exists, the templates are
verified by hand against an export, and the hand check is the one described in this section.

## What the Agents feature costs, and what it buys

**Costs, all of it documented by Slack** ([reference](https://docs.slack.dev/ai/developing-agents)):

- **Irreversible.** "Once you change your app's manifest from `assistant_view` to `agent_view`, you can't
  revert to the Assistant messaging experience."
- **A reinstall**, because `assistant:write` is a new scope — which means a new `xoxb` token and re-running
  `slopweaver secrets set slack-bot-token`.
- **Workspace guests lose access**: "Workspace guests are not permitted to access apps with the Agents
  feature enabled."
- **Every user must hard-refresh Slack** to see the change.

**What it buys, measured: two methods.** `assistant.threads.setTitle` and
`assistant.threads.setSuggestedPrompts`. Nothing else in this note is behind it, and neither is on the path a
tag takes — so the surface described at [the top of this doc](../slack-agent-surface.md) runs without it.

**Declaring the feature is not the same as holding the scope, and the header can lag the truth.** Measured
against the live app, which has the Agents feature on: within a single hour the bot token's
`x-oauth-scopes` header went from omitting `assistant:write` — with
`assistant.threads.setSuggestedPrompts` refusing `missing_scope`, `needed: "assistant:write"` — to listing it,
with the same call refusing only `channel_not_found`. Nothing in this repo changed in between.

Two things follow. A scope reaches a **token** through an install, not through the manifest edit, so it can
arrive later than the setting appears to. And **probe the method, do not infer from the header**: a refusal
naming the scope it needs is the answer, and `x-oauth-scopes` is a snapshot that can be behind.

## Where the pieces live

| File                                  | What it owns                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/live/listen/`                    | The transport: Socket Mode, the frame grammar, the channel-tag and 1:1-DM parse, redelivery, the reconnect plan. Every decision is a pure function tested without a socket.                                            |
| `src/live/turn/`                      | The turn: the ordering `turn brief`/`turn answer` drive from inside a visible session, the corpus query, the answer card, and the Slack adapter that posts it.                                                         |
| `src/outbound/assistant/todoBlock.ts` | The checklist. `renderTodoBlocks` → the `rich_text` + `context` date-footer pair; `todoTaskChunks` → the native `task_update` chunks. Pure, clock-free.                                                                |
| `src/outbound/assistant/footer.ts`    | The provenance footer as its `context` block, `·`-separated, with URL encoding kept distinct from label escaping. Pure.                                                                                                |
| `src/outbound/assistant/status.ts`    | The whole `assistant.threads.setStatus` contract — method name, argument names, limits, and the reading of a refusal — with the socket behind an injected transport so a unit test needs no mock. It never falls back. |

Every message a turn posts goes through `src/admit`, the same door as every other write.
