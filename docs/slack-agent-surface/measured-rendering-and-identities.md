# Measured

Part of [The Slack agent surface](../slack-agent-surface.md).

All API results in [this section](../slack-agent-surface.md) were obtained against a real workspace, using the bot token
this repo already holds (`$SLOPWEAVER_HOME/secrets/slack-bot-token`), and by reading the reference thread's raw
payload with `conversations.replies`. Probe writes went to the bot's DM **with itself**, so no human was
notified, and were deleted afterwards.

**Every workspace-specific id [below](../slack-agent-surface.md) is redacted** — `<refBotId>`, `<channelId>` and friends stand in for real
ones. That is the better write-up: nothing that mattered to a conclusion was an id, the payload SHAPES are verbatim, and a placeholder says which field is per-install.
Writing a real id here is allowed (`AGENTS.md` § "no secrets, ever"); it would still document less.

## 1. The reference UI is `rich_text`. It is not mrkdwn.

The reference agent's body blocks are `rich_text`, which is what this repo renders. One of its todo messages,
read raw:

```json
{
  "subtype": "bot_message",
  "username": "Claude [<the task in flight>]",
  "bot_id": "<refBotId>",
  "app_id": "<refAppId>",
  "metadata": { "event_type": "ccr_post" },
  "edited": { "user": "<refBotId>", "ts": "1785192578.000000" },
  "blocks": [
    { "type": "rich_text", "elements": [/* text runs, code spans via style.code, "\n" runs */] },
    {
      "type": "context",
      "block_id": "cc_session_date_footer",
      "elements": [{ "type": "mrkdwn", "text": "_todos as of <!date^1785192578^{time} ({ago})|<fallback time> UTC>_" }]
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "<https://claude.ai/code/session_<sessionId>|Open session in Claude> · claude-fable-5[1m] · <https://claude.ai/claude-in-slack/<teamId>/<channelId>/configure|Configure>"
        }
      ]
    }
  ]
}
```

The body is `rich_text`, and the mrkdwn-only `<!date^…>` token sits beside it in a sibling `context` block.
Both hold at once, which is the pattern: an mrkdwn-only feature goes in its own `context` block, never in the
body.

**Read `blocks`, never `text`.** A message's top-level `text` fallback IS mrkdwn — `<url|label>`, backticks,
the lot — so inspecting it will tell you the app renders mrkdwn when it does not. Slack renders `blocks` and
uses `text` only for notifications, search and export.

`src/outbound/assistant/todoBlock.ts` already does exactly this: its `context` block carries the mrkdwn-only
`<!date^…>` stamp beside a `rich_text` body. The spacing rules, the fold measurement and the card schema all
rest on it.

Other details read off the same payload, each encoded in code:

| Observed                                                                                     | Where it is encoded                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `✓` completed, `✱` in-flight glyphs                                                          | `STATE_GLYPH` in `src/outbound/assistant/todoBlock.ts`   |
| `_todos as of <!date^EPOCH^{time} ({ago})\|fallback>_`                                       | `todoAsOfText`                                           |
| Token epoch **equals** `edited.ts` — the stamp is "last written", not "turn began"           | `asOfEpochSeconds` is a parameter; nothing reads a clock |
| Footer: `·`-separated, model id as bare text carrying its own `[1m]` brackets                | `footerText` in `footer.ts`                              |
| Configure link is per-channel: `…/claude-in-slack/<teamId>/<channelId>/configure`            | taken as a URL; we build none                            |
| A stable `block_id` on the date footer                                                       | `TODO_AS_OF_BLOCK_ID`                                    |
| Code spans via `style.code`, bullets via `rich_text_list`, links as `{type:"link",url,text}` | already supported by `src/outbound/slack/render.ts`      |

## 2. The reference agent does not RENDER through the agent surface

`subtype: "bot_message"` with a `username` override is the classic `chat.postMessage` customise path. Every
message in the thread has that shape: no `task_card` block, no `streaming_state` field, and an ordinary
public-channel thread rather than an assistant thread. The per-task display name — `Claude [<the task in
flight>]` — is a **per-message `username`**, which needs `chat:write.customize`. **That scope is already in
`templates/slack-app-manifest.full.json`.**

Precisely what that does and does not establish: its **rendering and lifecycle** are plain post-and-edit, so
everything visually distinctive about it is reproducible with the scopes we hold. It does **not** establish
that the app never calls `assistant.threads.setStatus` — a set status leaves no message, so message history
cannot show one either way. The claim is about the renderer, which is what we are copying.

Verified end to end with our own token:

| Probe                                                                         | Result                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `chat.postMessage` with `username` + `rich_text` body + `context` date footer | `ok`; reads back `subtype: "bot_message"`, `username` verbatim, date token verbatim |
| `chat.update` on the same `ts`                                                | `ok`; edits in place, `edited.user` is the bot                                      |
| `chat.update` passing a **different** `username`                              | **the name does NOT change** — see below                                            |

**`username` and `bot_profile.name` are different fields, and both travel on every message.** The bracketed
per-task name is the former. A message posted with a `username` override reads back carrying **both**:

```jsonc
{
  // per-MESSAGE, set by the `username` argument, needs chat:write.customize
  "username": "slopweaver-bot [proving the agent surface]",
  // per-APP, the installed app's own name — the override does NOT touch it
  "bot_profile": { "name": "<the installed app's name>" },
}
```

So the per-task name is purely per-message and cannot alter the app's own name. Which of the two a given
surface renders is a client question this run could not settle (no interactive client — see [§ 7](todo-primitive-and-contract-facts.md#7-what-is-not-proven-here)); what is
settled is that they are independent, so nothing about a per-task name requires touching the app's identity.

**`chat.update` ignores `username`.** Measured: posted as `slopweaver-bot [measuring the agent surface]`, updated
passing `slopweaver-bot [writing it down]`, read back still `slopweaver-bot [measuring the agent surface]`. So the
per-task name is **immutable after the post**. A checklist edited in place cannot relabel itself; a new task
needs a new message. That is exactly why every message of one reference task carries one name, and the name
changes only between tasks.

## 3. Two identities, and which one does what

The reference app posts under two identities from the same `app_id`:

- **The bot** (`bot_id <refBotId>`) posts every working message, with the bracketed per-task `username`.
- **The app user** (`<refAppUserId>`) is what gets @-mentioned, and it is what leaves the receipt reaction.

The receipt is **`white_check_mark` from the app user**, not a reaction from the bot. Minor, but it is the kind
of detail that gets copied wrongly and then defended.

## 4. What needs the manifest change

Every assistant method, called with our existing token:

| Method                                  | Result                                       | Accepted under                   |
| --------------------------------------- | -------------------------------------------- | -------------------------------- |
| `assistant.threads.setStatus`           | **`ok: true`**                               | `acceptedScopes: ["chat:write"]` |
| `chat.startStream`                      | **`ok: true`**                               | `acceptedScopes: ["chat:write"]` |
| `chat.appendStream` / `chat.stopStream` | **`ok: true`**                               | `chat:write`                     |
| `assistant.threads.setTitle`            | `missing_scope`, `needed: "assistant:write"` | —                                |
| `assistant.threads.setSuggestedPrompts` | `missing_scope`, `needed: "assistant:write"` | —                                |

Slack's own reference is precise about the first row: setStatus "currently accepts either `assistant:write` or
`chat:write`, but will transition to `chat:write` only"
([reference](https://docs.slack.dev/reference/methods/assistant.threads.setStatus)).

**So the native thinking indicator, streaming APIs, native todo cards, per-task display name and provenance
footer all run on the scopes an ordinary install already holds.** Production checklists still use static
post/update messages for lifecycle safety. Only **thread titles** and **suggested prompts** sit behind
`assistant:write`.
