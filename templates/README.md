# The Slack app manifests

Three tiers. **The difference between them is a capability-versus-risk trade you make, not one this repo makes
for you** — so each one states what it enables and what it costs, and the safer path is offered in the same
breath as the permissive one.

| Tier                     | File                               | Enables                                                                                             | Risk                                                                                                                                      |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **STANDARD** _(default)_ | `slack-app-manifest.full.json`     | Everything: ingest, posting as the bot **and as you**, real-time search, and answering when tagged. | **The least secure option here.** Write scopes on your **own** user token, so a message it sends is indistinguishable from one you typed. |
| **MINIMAL** _(safer)_    | `slack-app-manifest.readonly.json` | Reading Slack history into your local corpus. Nothing else.                                         | The lowest on offer. No bot user, no write scopes — it can never post, and can never be tagged.                                           |
| **STANDARD + AGENTS**    | `slack-app-manifest.agent.json`    | Everything STANDARD does, plus Slack's Agents feature and its two thread methods.                   | STANDARD's risk, plus one cost that **cannot be undone**: enabling Agents is irreversible, guests lose access, and it needs a reinstall.  |

**STANDARD is the recommendation, not the imposition.** It is what makes the assistant whole — the tagged bot
does not exist without a bot user and Socket Mode. It is also the most permissive thing here, and the honest
description is that it is the least secure of the three. If that trade is not worth it, take **MINIMAL**: every
ingest verb, `derive`, `distil`, `store read` and `store cite` work exactly the same on it. What you give up is posting and
being tagged.

**STANDARD + AGENTS buys two methods** — `assistant.threads.setTitle` and
`assistant.threads.setSuggestedPrompts` — and **neither is on the path a tag takes**. Take STANDARD unless you
specifically want thread titles or suggested prompts, because the Agents toggle cannot be reverted.

## Before you paste

Each file carries **fields to populate**, and pasting one without filling them in creates an app literally
called `{{APP_NAME}}`:

| Field                  | In                                                     | Set it to                                 |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `{{APP_NAME}}`         | `display_information.name`                             | what the app is called in Slack           |
| `{{BOT_DISPLAY_NAME}}` | `features.bot_user.display_name` (STANDARD tiers only) | what its bot is called — usually the same |

They are placeholders on purpose. A committed template carrying a real name renames whatever app it is pasted
into, in every channel that app has ever posted in.

## These are FIRST-INSTALL artifacts

A Slack manifest is applied **whole**. Pasting one over an app that already exists renames it and its bot, and
**revokes every scope the pasted file does not list** — so a template that is even slightly behind a live app
turns capabilities off silently. To change an app that already exists, export **its own** manifest from
<https://api.slack.com/apps> → your app → **App Manifest**, and edit that.

## Keeping these true

The STANDARD tiers carry the live app's scope set. The live set is readable in one request — the
`x-oauth-scopes` response header on an `auth.test` call with each token — and
`src/__tests__/unit/connect/slackManifest.test.ts` pins the scopes whose absence is destructive by name, so a
hand edit cannot quietly drop them.

Two gaps, both named rather than left to be discovered:

- **No automated live-vs-committed check.** It needs live tokens, so it cannot be a CI lint lane. Also
  recorded in [`docs/constraints.md`](../docs/constraints.md).
- **These files are not validated against Slack's own schema.** `apps.manifest.validate` requires an app
  **configuration** token (`xoxe-`), which this repo does not hold — it refuses a bot token with
  `not_allowed_token_type`. So the structure here is checked by unit tests and by hand, not by Slack. A
  configuration token would make real validation possible.
