# 5. Slack's real-time search already works, and it needs nothing from the toggle

Part of [The assistant/agent surface: what the irreversible toggle actually buys](../slack-assistant-surface.md).

`assistant.search.context` is a member of the assistant family that this repo had never enumerated. It searches
messages, files, channels and users across the whole organisation, with semantic retrieval.

**With the bot token — OBSERVED:**

```
POST assistant.search.context {"query":"retrieval"}   → {"ok":false,"error":"invalid_action_token"}
```

Not `missing_scope`. The scope check passed. Its documented bot scopes are `search:read.files`,
`search:read.public` and `search:read.users`, and `auth.test`'s `x-oauth-scopes` header shows this app **already
holds all three**. The only missing input is an `action_token`, which per the
[method reference](https://docs.slack.dev/reference/methods/assistant.search.context) is "sent as received in a
message event": "All API calls made using a bot token require an `action_token`. API calls made using a user
token do not require an `action_token`."

**With the user token — OBSERVED, and it works:**

```
POST assistant.search.context {"query":"what is the retrieval pipeline","limit":2}
  → {"ok":true,"results":{"messages":[…2…],"files":[],"channels":[],"users":[]},
     "response_metadata":{"next_cursor":"…"}}
```

Each message result carries `author_name`, `author_email`, `author_user_id`, `team_id`, `channel_id`,
`channel_name`, `message_ts`, `content`, `is_author_bot` and `permalink`. `assistant.search.info` returns
`{"ok":true,"is_ai_search_enabled":true}` on both tokens, so semantic retrieval is on for this workspace.

**Why this matters more than the toggle does.** It is a grounded, permalink-citable retrieval source over
material the local corpus does not have — the user token's `search:read.private`, `search:read.im` and
`search:read.mpim` reach private channels and DMs the bot cannot see. It is reachable **today**, with **no
manifest change, no new scope, no reinstall and no irreversible click**. It is also a second read path with a
distinct trust profile, so it belongs in `docs/security.md` before it belongs in a verb.

**Slack's search needs no index at all and answers in one request**, where local retrieval is Postgres full
text over the store. That does not make it a replacement — it is remote, it is rate-limited to roughly ten
requests a minute per user, and it is a second egress in the sense `docs/security.md` cares about — but it is a
different trade, and piece **D** [below](multi-human-and-decomposition.md#decomposition) is sized against it.

**The cheap unresolved question — UNVERIFIED.** Does the `app_mention` event the shipped listener already
receives carry an `action_token`? If it does, the bot token reaches the same search with no user token at all.
`src/live/listen/frames.ts` keeps the raw event object, so the experiment is: run `slopweaver listen`, have the
owner tag the bot once, and grep the frame for `action_token`. Nothing in `src/` references that field today.

## 6. What the toggle changes for the existing bot

The existing app carries a large scope set and posts cards, drips, polls and threads. **This section is the one
the brief called the most important finding if anything here is true, and one thing is.**

**a) Pasting either committed manifest would silently revoke four live bot scopes — including the three that
make § 5 work. OBSERVED.** The installed app has drifted ahead of the committed templates:

| Committed manifest                        | Live bot scopes it OMITS                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `templates/slack-app-manifest.full.json`  | `metadata.message:read`, `search:read.files`, `search:read.public`, `search:read.users` |
| `templates/slack-app-manifest.agent.json` | the same four                                                                           |

The user token has drifted further: nine live user scopes appear in no committed manifest, and they include
the entire `search:read.{private,im,mpim,files,users,public}` family the § 5 probe depended on. **So the agent
manifest as prepared is not "the current manifest plus agent_view" — it is an older manifest plus `agent_view`,
and applying it is the moment Slack's real-time search stops working.** Fixing the templates is a prerequisite
to the owner's click, and it is cheap. (That a reinstall against a reduced manifest actually revokes the
dropped scopes is **DOCUMENTED** rather than observed — verifying it would require doing it.)

**b) Channel mentions are explicitly preserved. DOCUMENTED, and it is the reassuring finding:**

> Note: @-mentions in channels can happen like they do today; whether you support this or not is up to you. You
> can engage with the user or ask them to use the container to converse with your app.
> — [Developing an agent](https://docs.slack.dev/ai/developing-agents)

Nothing in Slack's documentation says the agent feature alters how an app's existing channel messages render or
behave. That is an absence of evidence, not evidence of absence — see [§ 9](multi-human-and-decomposition.md#9-what-is-not-proven).

**c) The event contract changes shape. DOCUMENTED.** `assistant_thread_started` stops being the signal that a
user opened a DM; `app_home_opened` with `tab === "messages"` replaces it; `app_context_changed` is added; and
"without the `assistant_thread_started` events, messages received in the DM channel will not have a root
message with `subtype = "assistant_app_thread"`; rather, the root message will appear from the user." The
shipped listener accepts channel `app_mention` events and a 1:1 DM message that tags the bot. The channel
path remains unaffected; the DM path therefore needs a real post-toggle probe before this surface can be
called safe.

**d) Workspace guests lose the app entirely. DOCUMENTED:** "Workspace guests are not permitted to access apps
with the Agents feature enabled." This is a property of the APP, not of the agent container, so it removes the
existing bot from every guest in the workspace.

**e) An admin can switch the surface off, per workspace.** Slack's help centre: "Owners and admins can manage
settings to decide whether these agents and assistants show up for their members", via Admin → Apps and
workflows → Installed apps → App Settings. **DOCUMENTED.** This workspace is an Enterprise Grid org
(`auth.test` returns an `enterprise_id` with `is_enterprise_install: false` — **OBSERVED**), so whether the
owner alone can complete this is an org-admin question, not only a developer one.

**f) A reinstall, and therefore a new bot token.** `assistant:write` is a new scope, so the app must be
reinstalled and `slopweaver secrets set slack-bot-token` re-run. The app-level token (`xapp-`) that Socket Mode
uses is not an install artefact, so `slopweaver listen` should survive untouched — **UNVERIFIED**, and worth
confirming before the click rather than after.

**g) Every user must hard-refresh Slack** to see the change. **DOCUMENTED.**

## 7. Irreversible, versus merely awkward

The brief asked for these separately, and separating them changes the answer.

**What Slack states is irreversible, verbatim:**

> Switching to `agent_view` cannot be reversed. Once you change your app's manifest from `assistant_view` to
> `agent_view`, you can't revert to the Assistant messaging experience.

**Read the subject of that sentence.** It is about switching **from `assistant_view` to `agent_view`** — the
migration between two messaging experiences. **This app appears to have NEITHER**, which means the documented
irreversibility describes a transition it cannot make, because it has never been in the starting state.

**"Appears to", and the word is load-bearing.** The live manifest cannot be read. **OBSERVED:**

```
POST apps.manifest.export {}  → {"ok":false,"error":"missing_scope","needed":"app_configurations:read",…}
POST apps.manifest.update {}  → {"ok":false,"error":"missing_scope","needed":"app_configurations:write",…}
```

Those need an app-configuration token, which is a different credential class from the two this repo holds. So
the claim rests on `templates/slack-app-manifest.full.json` — which declares no `assistant_view` — being the
manifest this app is actually installed from. **§ 6a shows that premise is already false in one direction**:
the live install has four bot scopes the template does not declare. Scope drift is additive and a `features`
block is not a scope, so this does not refute the claim — but it does mean nobody here has READ the live
`features` block, and the doc should not pretend otherwise. Confirming it costs the owner one glance at the
app's settings page.

**What is therefore genuinely irreversible for THIS app: UNVERIFIED.** Slack does not document whether enabling
the Agents feature on an app that has never had an assistant view can later be disabled. The manifest reference
lists `features.agent_view` as `Optional`, which is a weak hint that omitting it is legal — but "the field is
optional" and "removing the field restores the previous behaviour" are different claims, and only the first is
documented. **This distinction is the single most decision-relevant unknown in the document**, and no read-only
probe can settle it. It is [the question at the end](multi-human-and-decomposition.md#the-question-for-the-owner).

**Merely awkward, and all recoverable:**

| Cost                           | How you undo it                                                           |
| ------------------------------ | ------------------------------------------------------------------------- |
| A reinstall and a new `xoxb`   | `slopweaver secrets set slack-bot-token`                                  |
| The four dropped scopes (§ 6a) | Fix the templates before pasting; nothing is lost                         |
| Every user hard-refreshing     | Time                                                                      |
| The top-bar entry appearing    | An admin can disable the display per workspace (§ 6e)                     |
| Guests losing the app          | Reversible only by whatever reverses the feature — i.e. the open question |
