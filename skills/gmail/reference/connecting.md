# Connecting a mailbox, once — and which verb needs which scope

The two steps in order, the three things to say before the owner opens the Google Cloud page, and the
scope-to-verb table. The rule — the client secret is shown ONCE, and drafting and sending are separate
grants — is in [SKILL.md](../SKILL.md).

Gmail is the only source here that needs the owner's own consent in a browser rather than a token pasted
into a prompt. Two steps, in order:

1. **A Desktop-app OAuth client**, created once by the owner in Google Cloud, then stored:
   `slopweaver secrets set google-client-id` and `slopweaver secrets set google-client-secret`. Both read the
   value from a no-echo prompt or piped stdin, never from argv.

   **This is the USER-DATA client.** It serves the mail, Drive and calendar doors — the three that may hold
   write scopes on the owner's own data. The Google Admin door consents through a SECOND Desktop-app client
   in the same project, stored as `google-admin-client-id` / `google-admin-client-secret`: Google merges
   granted scopes over the (client, account) pair, so a client that has never been shown a write scope is
   the only thing that can keep an administrator credential read-only.

   Three things to say BEFORE they open the page, not after:
   - the project needs the **Gmail API** and the **Google Docs API** enabled
     (<https://console.cloud.google.com/apis/library/gmail.googleapis.com> and `docs.googleapis.com`);
   - the client type must be **Desktop app** — `gmail connect` listens on a loopback port chosen at run
     time, and only a Desktop-app client may use an arbitrary `127.0.0.1` port. A Web application client
     fails consent with `redirect_uri_mismatch`, which explains nothing to the person reading it;
   - **the client secret is shown ONCE**, in the dialog that appears the moment the client is created, and
     no page will ever show it again. Tell them to save the ID and the secret into their password manager
     before closing that dialog. Losing it means deleting the client and making another.

2. **`slopweaver gmail connect`** — it prints a consent URL, opens it, listens on `127.0.0.1` for the single
   redirect Google sends back, exchanges the code and stores the grant `0600` under
   `$SLOPWEAVER_HOME/secrets/gmail-oauth.json`. The socket serves one request and closes.

`--grant` chooses how much to ask for: `read` (`gmail.readonly`), `manage` (adds `gmail.modify`, the default)
or `full` (adds `gmail.compose` and `gmail.send`). **The grant records what Google ACTUALLY approved**, which
can be narrower than what was asked for — the consent screen lets a person untick scopes. When it is
narrower, `connect` says so on the spot, and the verbs needing the missing scope refuse by name rather than
failing at the API with a 403 that explains nothing.

### Which verb needs which scope

| verb                                                           | scope it needs                                          | in which `--grant` |
| -------------------------------------------------------------- | ------------------------------------------------------- | ------------------ |
| `gmail list`, `gmail read`, `gmail labels`, `gmail attachment` | `gmail.readonly` (or `gmail.modify`, which subsumes it) | `read`             |
| `gmail label`, `gmail mark`, `gmail archive`                   | `gmail.modify`                                          | `manage`           |
| `gmail draft`                                                  | `gmail.compose`                                         | `full`             |
| `gmail send`                                                   | `gmail.send`                                            | `full`             |
| reading a meeting transcript at ingest                         | `documents.readonly`                                    | every grant        |
| naming the bound mailbox                                       | `userinfo.email`                                        | always requested   |

A `--grant read` install can still `--dry-run` every mutation verb and see exactly what it WOULD change,
because planning a change is a read. Only applying it needs `gmail.modify`. The same split runs through the
outbound pair: reading a draft back and digesting it needs only `gmail.compose`, so a mailbox that has not
granted `gmail.send` can compose, preview and digest a message and will be refused by the CREDENTIAL at the
last step rather than by a code path.

`documents.readonly` rides on EVERY grant, including `read`, and it is not a Gmail scope. It is what lets
ingest follow the Google Doc a Gemini meeting-notes email links; without it the narrowest grant would ingest
half of every meeting and be unable to say which half. It reads a document **by id** — it cannot list or
search a Drive, and it cannot write — and the only ids it is ever handed come from a message whose sender is
one of Google's own meeting addresses. A person who declines it on the consent screen has made a legitimate
choice: `connect gmail --check` reports it as a warning, and meetings still ingest with their summary.

Two of Google's rules are worth knowing rather than discovering: `gmail.modify` subsumes `gmail.readonly`,
so a `manage` grant reads fine — but `gmail.send` does NOT subsume `gmail.compose`. Composing a draft and
sending a message are separate grants, which is what makes "drafts are the default, sending is a separate
deliberate act" a property of the credential and not merely of a code path.

`slopweaver gmail connect --status` answers "which mailbox, and what may I do with it" with **no browser, no
socket and no network call**. Reach for that, never a fresh consent flow, to check a connection. It reports
the account, the granted scopes and the grant file's path — never token material.

**A Testing-status OAuth client's refresh token lapses seven days after consent.** Google says so at consent
with `refresh_token_expires_in`, and the grant records the instant. `connect` names it on landing; `--status`
prints it and warns on stderr inside 48 hours of it and once it has passed. A Production client's grant
records nothing, and nothing is printed.

`slopweaver connect gmail --check` is the fuller preflight: it adds one live call to prove the grant still
reaches the mailbox, and breaks the scopes out one row per verb family. A declined optional scope is a
**warning**, not a failure — a read-only grant is a legitimate choice. A recorded lapse adds a `refresh-token`
row: a **warning** inside 48 hours, **missing** once passed.
