# 2. The native chrome — automatic, API-driven, or unavailable

Part of [The assistant/agent surface: what the irreversible toggle actually buys](../slack-assistant-surface.md).

**DOCUMENTED throughout.** Slack's own summary of the surface:

> Slack offers dedicated surfaces for agents, including a split-view container, top navigation entry point,
> app threads, text streaming, and suggested prompts. — [AI in Slack overview](https://docs.slack.dev/ai/)

| Chrome                     | How it arrives                                                                                                                              | Needs the toggle?                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Top-bar entry point        | Automatic once `agent_view` is on                                                                                                           | **Yes**                                           |
| Split-plane container      | Automatic once `agent_view` is on                                                                                                           | **Yes**                                           |
| App threads (the timeline) | Automatic: "Slack will automatically group your app conversations into threads, shown in a timeline above the composer in the Messages tab" | **Yes**                                           |
| Thread title               | API-driven — `assistant.threads.setTitle`                                                                                                   | **Yes** (`assistant:write` — OBSERVED, § 3)       |
| Suggested prompts, dynamic | API-driven — `assistant.threads.setSuggestedPrompts`                                                                                        | **Yes** (`assistant:write` — OBSERVED, § 3)       |
| Suggested prompts, static  | `features.agent_view.suggested_prompts` in the manifest                                                                                     | **Yes**, but needs NO scope and no method call    |
| Container actions          | `features.agent_view.actions` — "an array of action objects available in the agent container"                                               | **Yes**                                           |
| Thinking indicator         | API-driven — `assistant.threads.setStatus`                                                                                                  | **No** — OBSERVED accepted under `chat:write`     |
| Text streaming             | API-driven — `chat.startStream`/`appendStream`/`stopStream`                                                                                 | **No** — OBSERVED accepted under `chat:write`     |
| Task cards / plan blocks   | Block Kit, ordinary blocks                                                                                                                  | **No** — OBSERVED valid under current scopes, § 4 |
| Feedback buttons           | Block Kit `context_actions`                                                                                                                 | **No** — OBSERVED valid under current scopes, § 4 |
| Input placeholder          | Not documented anywhere                                                                                                                     | **UNVERIFIED**                                    |

**Two corrections to what "the toggle buys suggested prompts" implies.** First, `features.agent_view` carries
its own `suggested_prompts` array, so STATIC prompts are a manifest field and cost no scope — only prompts that
vary per thread need the gated method. Second, `features.agent_view.actions` is a chrome affordance nobody in
this repo has mentioned before: named actions offered inside the container. Both are in the
[app manifest reference](https://docs.slack.dev/reference/app-manifest); neither is in
`templates/slack-app-manifest.agent.json` as prepared.

## 3. Every method the surface exposes

The family was enumerated by calling candidate names with an empty body: Slack answers `unknown_method` for a
name that does not exist, and `missing_scope` or `invalid_arguments` for one that does. Empty arguments mean
nothing could mutate. **All OBSERVED, bot token unless stated.**

| Method                                                                                                                                                               | Literal response                                                                  | Verdict                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| `assistant.threads.setStatus`                                                                                                                                        | `{"ok":false,"error":"invalid_arguments",…"missing required field: channel_id"…}` | reachable, `chat:write`     |
| `assistant.threads.setTitle`                                                                                                                                         | `{"ok":false,"error":"missing_scope","needed":"assistant:write",…}`               | **gated**                   |
| `assistant.threads.setSuggestedPrompts`                                                                                                                              | `{"ok":false,"error":"missing_scope","needed":"assistant:write",…}`               | **gated**                   |
| `assistant.search.context`                                                                                                                                           | `{"ok":false,"error":"invalid_action_token"}` — scope check PASSED                | reachable, see § 5          |
| `assistant.search.info`                                                                                                                                              | `{"ok":true,"is_ai_search_enabled":true}`                                         | reachable now               |
| `chat.startStream`                                                                                                                                                   | `{"ok":false,"error":"invalid_arguments",…"missing required field: channel"…}`    | reachable, `chat:write`     |
| `chat.appendStream`                                                                                                                                                  | `{"ok":false,"error":"invalid_arguments",…"missing required field: ts"…}`         | reachable, `chat:write`     |
| `chat.stopStream`                                                                                                                                                    | `{"ok":false,"error":"invalid_arguments",…"missing required field: ts"…}`         | reachable, `chat:write`     |
| `blocks.validate`                                                                                                                                                    | `{"ok":true}` on a valid block array                                              | reachable, no special scope |
| `apps.manifest.export`                                                                                                                                               | `{"ok":false,"error":"missing_scope","needed":"app_configurations:read",…}`       | needs an app-config token   |
| `assistant.threads.list` / `.get`                                                                                                                                    | `{"ok":false,"error":"unknown_method"}`                                           | does not exist              |
| `assistant.setStatus`, `agents.threads.setStatus`, `apps.agents.list`, `assistant.search.run`, `assistant.threads.setSuggestions`, `assistant.threads.appendMessage` | `{"ok":false,"error":"unknown_method"}`                                           | do not exist                |

**"Two methods" is true, narrowly, and the wrong summary.** `setTitle` and
`setSuggestedPrompts` are the only two methods `assistant:write` unlocks. But the family is larger: `assistant.search.context` and `assistant.search.info` were never enumerated, and neither
needs `assistant:write`. What the toggle buys is not "two methods" — it is **a placement plus two methods**,
and the placement is the part the owner is asking about.

## 4. The native task chrome is Block Kit, and it is available right now

This is the most build-relevant finding in the document. [`slack-agent-surface.md` § 5](../slack-agent-surface/todo-primitive-and-contract-facts.md) measured `task_update`
chunks inside a `chat.appendStream`, and recorded four sharp costs of that path — a sticky stream mode, an
undeletable open stream, `stopStream` rewriting every unfinished task to `error`, and no readable `blocks`
mid-stream. All four are properties of **streaming**, not of the cards.

`blocks.validate` is a read-only endpoint that runs Slack's own block validator. **OBSERVED**, with this app's
current scopes and no manifest change:

```
POST blocks.validate {"blocks":[{"type":"task_card","task_id":"t1","title":"Probe the surface","status":"in_progress"}]}
  → {"ok":true}
POST blocks.validate {"blocks":[{"type":"plan","title":"Plan","tasks":[{"task_id":"t1","title":"x","status":"pending"}]}]}
  → {"ok":true}
POST blocks.validate {"blocks":[{"type":"context_actions","elements":[{"type":"feedback_buttons","action_id":"fb",
     "positive_button":{"text":{"type":"plain_text","text":"Good"},"value":"good"},
     "negative_button":{"text":{"type":"plain_text","text":"Bad"},"value":"bad"}}]}]}
  → {"ok":true}
POST blocks.validate {"blocks":[{"type":"context_actions","elements":[{"type":"icon_button","icon":"trash",
     "text":{"type":"plain_text","text":"Delete"},"action_id":"del","value":"d"}]}]}
  → {"ok":true}
```

The enums are hard evidence, because they come back as refusals naming the accepted set:

```
POST blocks.validate {"blocks":[{"type":"task_card","task_id":"t1","title":"x","status":"bogus"}]}
  → {"ok":false,"error":"invalid_blocks","errors":[{"code":"failed_constraint",
       "constraint":{"type":"enum","expected":["in_progress","complete","error"]},"pointer":"/0/status"}]}
POST blocks.validate {"blocks":[{"type":"plan","title":"Plan","tasks":[{"task_id":"t1","title":"x","status":"bogus"}]}]}
  → {"ok":false,"error":"invalid_blocks","errors":[{"code":"failed_constraint",
       "constraint":{"type":"enum","expected":["pending","in_progress","complete","error"]},"pointer":"/0/tasks/0/status"}]}
POST blocks.validate {"blocks":[{"type":"context_actions","elements":[{"type":"zzz"}]}]}
  → {"ok":false,…"constraint":{"type":"enum","expected":["icon_button","feedback_buttons"],"got":"zzz"}…}
```

**Three consequences.**

1. **A `task_card` has three states, not four.** `in_progress`, `complete`, `error`. `pending` is a `plan`
   state only. Slack's prose says the states are "`in_progress`, `completed`, and `error`" — the API enum says
   `complete`. **The docs are wrong about a string an implementation would have to get exactly right**, which
   is why this repo measures rather than cites.
2. **A checklist does not need a stream.** If `task_card` and `plan` post as ordinary blocks, all four measured
   streaming costs evaporate — the message stays deletable, editable, readable and mixable with prose. See the
   caveat immediately below before treating that as settled.
3. **The full block-type enum came back in a refusal**, and it includes several primitives this repo has never
   used: `plan`, `task_card`, `context_actions`, `callout`, `alert`, `card`, `table`, `data_table`, `carousel`,
   `container`, `message_embed`, `loading`, `markdown`, `data_visualization`.

**The caveat that stops this being a `gold` claim, stated because it is easy to miss.** `blocks.validate`
accepted `{"type":"task_card","task_id":"t1","title":"x","status":"complete","zzz":1}` with `{"ok":true}` —
**it does not reject unknown fields.** So an `{"ok":true}` proves the block TYPE and the ENUMS, and proves
nothing about whether a field name renders. And whether `chat.postMessage` accepts a `task_card` outside a
stream at all is **UNVERIFIED** — confirming it requires a write, which this run was not allowed. That single
write is the first thing the piece in [§ "Decomposition"](multi-human-and-decomposition.md#decomposition) row **C** should do.
