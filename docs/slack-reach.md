# Slack reach — everything the token can read, and how we prove it

The standing rule: every channel the token can see means every conversation for which an API call would not
return 403, not only the channels the owner is a member of. This document is the contract that follows from it: what "reachable" means for Slack, what the connector does about it, and the
one command that refuses to call coverage complete while anything reachable is missing.

Numbers below were measured live against the real workspace, read-only, through this
repository's own Slack read seam.

## Membership is not the access boundary — the TOKEN is

Measured, per token, by asking `conversations.history` for one page of every conversation
`conversations.list` returned:

| Conversation kind              | User token | Bot token                          |
| ------------------------------ | ---------- | ---------------------------------- |
| Public channel, a member       | reads      | `not_in_channel` unless invited    |
| Public channel, NOT a member   | **reads**  | `not_in_channel`                   |
| Private channel the user is in | reads      | `channel_not_found` unless invited |
| DM the user is party to        | reads      | `channel_not_found`                |
| Archived channel               | **reads**  | as its live counterpart            |

Nearly every non-archived conversation answered for the user token; the sole refusal was a DM
(`channel_not_found`, a deactivated counterpart). Hundreds were public channels the owner had never
joined. The bot token, by contrast, answered for exactly the channels it had been invited to.

Two consequences, and they are the whole design:

- A user-token crawl must not filter by `is_member`. It never did — `selectChannels` has always returned
  every discovered channel — but the audit that preceded this work read the empty channels as an access
  boundary doing its job, and that reading was wrong.
- A bot-token crawl genuinely cannot see most of the workspace. `resolveSlackReadToken` already prefers the
  user token and warns when it falls back, and that warning is load-bearing rather than cosmetic.

**What is deliberately out of reach**, and stays out: private channels the owner is not in, and other
people's DMs. Reaching those needs admin-level scopes the install does not request. That is a privacy line,
not an oversight.

- [Five gaps this work closed](./slack-reach/gaps-archived-and-cursors.md)
  - [1. Archived channels were never even discovered](./slack-reach/gaps-archived-and-cursors.md#1-archived-channels-were-never-even-discovered)
  - [2. One pooled cursor could not express "never crawled"](./slack-reach/gaps-archived-and-cursors.md#2-one-pooled-cursor-could-not-express-never-crawled)
- [3. Every known thread was re-polled, to discover that 0.67 % of them had moved](./slack-reach/gaps-repoll-bots-and-classes.md)
  - [4. Bot-authored posts were suspected, and were never the problem](./slack-reach/gaps-repoll-bots-and-classes.md#4-bot-authored-posts-were-suspected-and-were-never-the-problem)
  - [5. Asking for every conversation class at once reached LESS than asking twice](./slack-reach/gaps-repoll-bots-and-classes.md#5-asking-for-every-conversation-class-at-once-reached-less-than-asking-twice)
- [Records say where they came from](./slack-reach/provenance-coverage-and-proof.md)
  - [Coverage is a command, not a claim](./slack-reach/provenance-coverage-and-proof.md#coverage-is-a-command-not-a-claim)
  - [Proof of the backfill](./slack-reach/provenance-coverage-and-proof.md#proof-of-the-backfill)
  - [What is still owed](./slack-reach/provenance-coverage-and-proof.md#what-is-still-owed)
