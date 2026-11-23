# Creating the Slack app, the Google OAuth client and the Outlook registration

The things a person creates before any token exists, and the irreversible choices inside each. The rules — recommend `agent` and name its cost, and say the Google secret is shown once BEFORE they
open the page — are in [SKILL.md](../SKILL.md).

## 4a — Create the Slack app (from the bundled manifest)

Slack is the only source that needs an app. Guide the user to create one from the bundled manifest — do NOT
try to auto-create it. If they **already run a Slack app** with these scopes, they can skip creation and
reuse its existing **User OAuth Token** instead.

**If the user already runs a Slack app with these scopes**, do NOT hand them a manifest at all — tell them to
open <https://api.slack.com/apps> → their app → **App Manifest**, and edit that; a manifest is applied whole
and pasting one over an existing app renames it and revokes every scope the paste omits.

1. Run `slopweaver onboard --tier <agent|standard|restricted>` — it renders the manifest to paste, states
   what each tier buys and costs, and says what happens after the paste. **Use it rather than a bundled
   template file**: the manifest is rendered from the same scope declarations the code uses, so it cannot
   drift from what the connectors actually need. Pass the step-3 answer verbatim; with no `--tier` it asks,
   and a bare Enter takes `agent` (the recommended tier, and the one it names as least secure).
2. Follow the "Where it goes" block it prints: <https://api.slack.com/apps> → **Create New App** → **From an
   app manifest** → their workspace → paste → Create → **Install to Workspace**. Paste into a **new** app —
   a manifest applied to an existing one replaces its whole configuration and revokes omitted scopes.
3. Copy the **User OAuth Token** (`xoxp-…`). Prefer the user token (full read breadth); a bot token
   (`xoxb-…`) works but only sees invited channels — `connect slack --check` will warn about that. The
   `agent` and `standard` tiers also provision a bot user, so copy its `xoxb-` token too.

## 4b — Create the Google OAuth client (Gmail only) — the SECRET IS SHOWN ONCE

Skip this whole step if they are not connecting Gmail. If they are, say all of it **before** they open the
page, because two of the three cannot be recovered from afterwards.

1. Pick or create a Google Cloud project: <https://console.cloud.google.com/projectcreate>.
2. **Enable two APIs on it.** A disabled API fails at the first call with a 403 naming it:
   - Gmail API — <https://console.cloud.google.com/apis/library/gmail.googleapis.com> (every `gmail` verb
     and the whole ingest);
   - Google Docs API — <https://console.cloud.google.com/apis/library/docs.googleapis.com> (reading the
     meeting transcript a Gemini notes email links, rather than only its inline summary).
3. **Credentials → Create credentials → OAuth client ID → application type DESKTOP APP.**
   <https://console.cloud.google.com/apis/credentials>. Desktop app is not a preference: `gmail connect`
   listens on a loopback port chosen at run time, Google permits an arbitrary `127.0.0.1` port only for a
   Desktop-app client, and a Web application client fails consent with `redirect_uri_mismatch` — an error
   that explains nothing to the person reading it.
4. **The client secret is shown ONCE**, in the dialog that appears the moment the client is created. No page
   will show it again; the only recovery is to delete the client and make another. Tell them, in these
   words, to **save the client ID and the client secret into their password manager before
   closing that dialog** — then capture both in step 5. Never ask them to paste either into this chat.

## 4c — The Outlook app registration (Outlook only) — nothing is shown once

Skip this if they are not connecting a personal Microsoft mailbox. Outlook is a LIVE connector: read at
question time by the `outlook` verbs, never crawled, so it has no backfill. Its registration is the opposite
of Google's client: a public client using PKCE, so there is **no secret** to lose, and the client id can be
copied off the registration's Overview again any time.

**Reuse a registration that already admits personal accounts** rather than making another: one made for an
earlier install, or one that admits work and personal accounts both, works once it carries the Mobile and
desktop `http://localhost` redirect. The exact settings, a fresh registration included, are in
[the outlook connecting reference](../../outlook/reference/connecting.md). Capture its **Application (client)
ID** as `outlook-client-id` in step 5; the consent itself is `slopweaver outlook connect --grant manage`.
