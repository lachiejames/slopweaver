# How to read the evidence grades

Part of [The assistant/agent surface: what the irreversible toggle actually buys](../slack-assistant-surface.md).

Every claim [below](../slack-assistant-surface.md) is tagged. There are only three tags, and they are not interchangeable:

| Tag            | Means                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| **OBSERVED**   | A literal request was sent and the literal response is quoted.                         |
| **DOCUMENTED** | Slack's own docs say it and nothing was run. Slack's docs have been wrong here before. |
| **UNVERIFIED** | Neither. Stated as a gap, with the experiment that would close it.                     |

**Overall grade: `silver` for [§§3–6](../slack-assistant-surface.md) (every method and block claim carries an observed response), `bronze` for
[§§1–2 and §7](../slack-assistant-surface.md) (the badge, the chrome and the irreversibility are documentation, because no API exposes them).**

Every workspace-specific identifier is redacted — `<botId>`, `<channelId>`, `<refAppUserId>`. Required when
this was written, and kept because a placeholder says which field is per-install: nothing that mattered to a
conclusion was an id. A real one is allowed now (`AGENTS.md` § "no secrets, ever") and documents less.

## Measured

## 0. What this run was allowed to touch, and what it therefore could not learn

The brief said read-and-measure-only: no manifest applied, no app configuration changed, no scope requested,
and no method call that mutates a thread. That was honoured, and it has a consequence worth stating up front
rather than discovering in [§9](multi-human-and-decomposition.md#9-what-is-not-proven) — **no claim [below](../slack-assistant-surface.md) required a write, and so no claim [below](../slack-assistant-surface.md) is about how anything
LOOKS.** Two probes were designed and then declined:

- **Streaming into a channel thread.** `chat.startStream` validates `thread_ts` before it validates the
  recipient arguments, so distinguishing "a channel stream needs a named recipient" from "that thread does not
  exist" requires a REAL thread in a REAL channel. **OBSERVED**, all four variants:

  ```
  POST chat.startStream {"channel":"<channelId>","thread_ts":"0000000000.000000"}                          → {"ok":false,"error":"invalid_thread_ts"}
  POST chat.startStream {… ,"recipient_user_id":"<userId>"}                                                → {"ok":false,"error":"invalid_thread_ts"}
  POST chat.startStream {… ,"recipient_user_id":"<userId>","recipient_team_id":"<teamId>"}                  → {"ok":false,"error":"invalid_thread_ts"}
  POST assistant.threads.setStatus {"channel_id":"<channelId>","thread_ts":"0000000000.000000","status":"…"} → {"ok":false,"error":"invalid_thread_ts"}
  ```

  The only channel the bot could have used was live and had many human members. An open
  stream cannot be deleted until it is stopped (measured in [`slack-agent-surface.md` § 5](../slack-agent-surface/todo-primitive-and-contract-facts.md)), so a failed probe
  there would have left a message nobody could clear in front of that audience. Declined. The recipient requirement is carried forward
  as a prior measurement, attributed, not re-run.

- **Whether an `app_mention` event carries an `action_token`.** See [§ 5](search-and-toggle.md) — it matters, it is cheap, and it needs
  one tag from the owner while `slopweaver listen` is running.

## 1. What produces the "Agent" label — and why no API can tell you

**The mechanism is `features.agent_view` in the app manifest, equivalently the "Agents" feature toggle in app
settings. DOCUMENTED, and the sentence names the placement rather than the word:**

> To allow your agent to live in the top bar and be available for interaction in the split plane, you'll need
> to create an app, then find the Agents feature in the sidebar, and enable it. The `assistant:write` scope is
> needed for this, and thus is automatically added to your app when you enable the feature in the app settings.
> — [Developing an agent](https://docs.slack.dev/ai/developing-agents)

Read that carefully, because it is the answer to the question actually asked and it is not the answer the
question expected. What the toggle buys is a **placement**: the top bar, and the split-plane container. Slack's
developer documentation **never uses the words "Agent label" or "badge" at all**. So:

- The **top-bar entry and the split-view container** are `features.agent_view`. **DOCUMENTED.**
- A literal word "Agent" rendered next to the app name in a thread is **UNVERIFIED**. It may be that, it may be
  an app-directory property, it may be a client string that follows from the same flag. Nothing this run could
  reach distinguishes them.

**Three independent negative probes establish that no API this app can call exposes an agent flag at all.**
Each compares the reference agent already installed in this workspace against this repo's own bot:

| Probe                                                                | Result                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.info` on the reference app user vs. on our bot user           | **OBSERVED**: byte-identical key sets. The only differing values are `id`, `api_app_id`, `bot_id`, names and avatar hashes.                                 |
| `conversations.list?types=im` over every DM, grouped by `properties` | **OBSERVED**: 70 DMs collapse into 5 signatures, all of them `tabs`/`tabz`/`is_dormant`. No AI app has a distinguishing one.                                |
| `bots.info` on each app's `profile.bot_id`                           | **OBSERVED**: `{"ok":false,"error":"bot_not_found"}` for BOTH — symmetric, so it proves nothing either way. Recorded so nobody re-reads it as a difference. |

The second is the strongest: it includes the reference agent, this repo's bot, and every other AI-ish app
installed here, and **not one DM channel object carries an assistant/agent marker**. The badge is rendered by
the client from app configuration that no bot or user token can read.

**How you would actually settle it:** the owner opens the owner's own client and looks. That is a stronger form of
evidence than anything in this document, it costs the owner five seconds, and it is in [the question at the end](multi-human-and-decomposition.md#the-question-for-the-owner).

**One measured fact bounds the claim usefully.** The reference agent in this workspace posts plain
`bot_message`s with a `username` override and its DM carries no marker — so whatever badge the owner sees on
it, if the owner sees one, is **not** coming from the message payload. That was already established in
[`slack-agent-surface.md` § 2](../slack-agent-surface/measured-rendering-and-identities.md#2-the-reference-agent-does-not-render-through-the-agent-surface) and is re-confirmed here.
