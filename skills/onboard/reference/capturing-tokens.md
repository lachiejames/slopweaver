# Capturing each token, pasted into the console, never in chat

The secret name plus its caveats for each source. The rule — a token never touches this chat, an argv, or the repo
— is in [SKILL.md](../SKILL.md).

For each source the user wants, post one hand step: `--url` the provider page the token is minted on, `--literal`
its `slopweaver secrets set <name>` lines (one name per line), `--where "the fields on this card"`. Then send them to
the step's card, `http://localhost:3000/queue?open=hand%3A<id>`. The card draws a secure paste field per name in
place of the command; they paste, press **Set**, and the card answers `set <name>`. The value goes to `secrets set
--stdin` on the console's own machine and lands `0600` under `$SLOPWEAVER_HOME/secrets/` — never the chat, an argv,
or the repo, and never echoed back. The mechanism and its residue: [pasting a
secret](../../hand/reference/pasting-a-secret.md).

Show them the page too. Before posting, take the provider page through `slopweaver browser inspect` — the list or
the "New key" button, never the dialog showing a minted token — and post it with `--shot <png>` and one `--box
x,y,width,height=label` per thing to click, in the picture's pixels and in the order they act. The card draws the
page above the paste fields with a numbered red box on each, so they find the button without leaving the console:
[showing the page](../../hand/reference/showing-the-page.md).

A terminal still works, for a user who prefers one or a script: `slopweaver secrets set <name>` prompts with echo
off, and `--stdin` takes a pipe. Repeat with the right secret name per source (only the tools they use):

- `slack-user-token` (or `slack-bot-token` for the limited bot fallback)
- `linear-token` — a Linear personal API key (Linear → Settings → API → Personal API keys). Note for the
  user: the Linear read is the widest of the four connectors — within the chosen window it captures ARCHIVED
  work, customer needs (verbatim customer prose), external commenters and their emails, and the per-issue
  activity history. All of it stays local. `docs/security/data-flow.md` states the scope in full. If the user
  already runs an assistant, reuse its existing key.
- `notion-token` — a Notion internal integration secret; the integration must have the
  **read user information (including email)** capability (and **update/insert** too for full access), and the
  pages/databases must be **shared** with it.
- `datadog-api-key` and `datadog-app-key` — one card, both names, AFTER `profile.json`'s `datadog.site` is set,
  because the key pages live on the org's own site and are derived from it rather than hard-coded:
  `datadogKeyPages` in `src/datadog/config.ts` maps the site through `consoleHostFor`, so `us3.datadoghq.com`
  gives https://us3.datadoghq.com/organization-settings/api-keys and
  https://us3.datadoghq.com/organization-settings/application-keys, while US1's `datadoghq.com` is served from
  `app.datadoghq.com`. `connect datadog --check` prints the same two URLs for whatever site is set. The API key
  is the organisation's; the **application key is personal and scoped to the minting person's own Datadog
  permissions**, so a colleague who onboards gets a view of exactly what their own role can read, and two people
  can get different answers to the same query. `DD_API_KEY`/`DD_APP_KEY`/`DD_SITE` in the environment still win
  over the store and the profile, for a one-off run against another org.
- `github-token` — usually unnecessary: GitHub uses your `gh auth login`. Only capture one if
  `connect github --check` reports GitHub auth missing. Once stored it wins over the `gh` login, so every
  GitHub verb, `--home` included, authenticates as that token's account.
- `google-client-id` and `google-client-secret` — the USER-DATA Desktop-app OAuth client from step 4b, out
  of their password manager. It serves the mail, Drive and calendar doors; the Google Workspace Admin door
  is not part of onboarding and has a second client of its own (`google-admin-client-id`). Then **Gmail's one
  consent step, in the browser**:
  `slopweaver gmail connect --grant read` prints a consent URL, opens it, listens on `127.0.0.1` for the
  single redirect and stores the grant `0600`. `--grant manage` adds label/archive/read-state writes and
  `--grant full` adds drafting and sending; `read` is the right default for a world model. Every grant also
  asks for `documents.readonly`, which is what lets ingest follow the Google Doc a Gemini meeting-notes
  email links — say so, because it is not a Gmail scope and a person reading the consent screen will notice.
  Declining it is a legitimate choice and meetings still ingest, with the email's summary as their text.
- `outlook-client-id` — the Outlook app registration's Application (client) ID from step 4c. An identifier,
  not a secret. Then **Outlook's one consent step**: `slopweaver outlook connect --grant manage` prints a
  consent URL, opens it, listens on `localhost` for the single redirect and stores the grant `0600`.
  `--grant read` reads only and `--grant full` adds `Mail.Send`; `manage` is the default because organising
  is what a person reaches for straight after reading.

## Showing the store back

`slopweaver secrets status` is the read side, and the only thing in this flow that can answer "what have I
actually connected?" It lists every credential with its platform, what it is, its scope at mint, its expiry
and which verb reads it — and **never a value**. Run it once after this step: it confirms what just landed,
and it leads with anything already standing that nothing reads, whose mode is not `0600`, or whose stored
Google grant has gone stale. `--all` adds the credentials this install has not connected; `--json` emits
every row.
