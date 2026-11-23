# Why the agent container says "This agent is unavailable"

Measured against the live app and Slack's published reference. This note exists because the
question had a standing hypothesis that turned out to name the wrong event, and a hypothesis restated often
enough starts reading as a finding.

It is deliberately narrow: it records what was measured, what Slack documents, and the one thing that is
still unproven. It does not describe the agent surface generally — that is
[slack-agent-surface.md](slack-agent-surface.md).

## The standing hypothesis, and why it is wrong

The hypothesis was that the availability check wants `assistant_thread_started` (and
`app_context_changed`) subscribed, and that the app subscribes neither.

Slack's own configuration reference makes the first half wrong. There are **two** messaging experiences and
they need **different** events:

| Messaging experience        | Manifest key     | Events Slack requires                                                        |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| **Agent** (the current one) | `agent_view`     | `app_home_opened`, `app_context_changed`, `message.im`                       |
| **Assistant** (deprecated)  | `assistant_view` | `assistant_thread_started`, `assistant_thread_context_changed`, `message.im` |

`assistant_thread_started` belongs to the deprecated experience, and Slack states that new apps can only use
the Agent experience and that switching to it "cannot be reversed". This app renders the `AGENT` badge and
delivers `app_home_opened` when a DM is opened, both of which are the Agent experience behaving as documented.

So **subscribing `assistant_thread_started` is not the fix**, and an earlier recon's observation that
`app_home_opened` replaces it as the DM-opened signal was a statement about signalling, not availability.

## What was measured, and what it rules out

**The scope is granted.** `assistant.threads.setTitle` was called with the bot token this repo holds against
a deliberately non-existent channel and answered `channel_not_found`, not `missing_scope`. The call passed
authorisation, so `assistant:write` is live (`src/outbound/assistant/status.ts` carries both measurements).

**It is not the bot's presence.** With a Socket Mode connection held open for a minute, `users.getPresence`
reported `away`, `online: false`, `connection_count: 0` on every poll, while the bot user's profile already
carried `always_active: true`. Socket Mode connectivity does not surface as presence at all, so the
container's verdict cannot be reading it.

## What is still unproven, and the one change it would take

Of the three events the Agent experience requires, `app_context_changed` is the one this app does not
subscribe to. That is the precise gap, and it is a **documented requirement measured absent** — not a
demonstrated cause. Nothing here proves that adding it flips the string.

It cannot be proven from this machine. Subscribing an event is an app-configuration change plus a reinstall,
which are the owner's actions, and reading the container's verdict needs eyes on the Slack client. So the
change to make, and the reason:

> **Event Subscriptions → add the bot event `app_context_changed`, then reinstall.** It is one of the three
> events Slack documents as required for the `agent_view` messaging experience, and it is the only one of the
> three the app is missing. The committed `templates/slack-app-manifest.agent.json` subscribes neither
> `app_home_opened` nor `app_context_changed`, so it needs the same change.

If the container still says unavailable after that, availability is about something other than the
subscriptions, and that is the more valuable finding — record it here.
