# Connecting a Drive, once — and which verb needs which scope

The two steps in order, the three things to say before the owner opens the Google Cloud page, and the
scope-to-verb table. The rule — the narrow grant is the default, and what the write grant can and cannot
reach — is in [SKILL.md](../SKILL.md).

Like the mail door, this one needs the owner's own consent in a browser rather than a token pasted into a
prompt. Two steps, in order:

1. **A Desktop-app OAuth client**, created once by the owner in Google Cloud, then stored:
   `slopweaver secrets set google-client-id` and `slopweaver secrets set google-client-secret`. Both read
   the value from a no-echo prompt or piped stdin, never from argv.

   **If the mail door is already connected, this step is already done.** One Desktop-app client serves the
   three USER-DATA doors — mail, Drive and calendar — because a client identifies the APPLICATION asking for
   consent and not the account granting it. `slopweaver gmail connect --status` reporting a connected
   mailbox proves the pair is stored, so check that before sending anyone to Google Cloud. The Google Admin
   door is the exception and uses `google-admin-client-id` / `google-admin-client-secret`, a SECOND
   Desktop-app client in the same project: Google merges granted scopes over the (client, account) pair, so
   a client that has never been shown a write scope is the only thing that can keep an administrator
   credential read-only.

   Three things to say BEFORE they open the page, not after:
   - the project needs the **Google Drive API** enabled
     (<https://console.cloud.google.com/apis/library/drive.googleapis.com>);
   - the client type must be **Desktop app** — `drive connect` listens on a loopback port chosen at run
     time, and only a Desktop-app client may use an arbitrary `127.0.0.1` port. A Web application client
     fails consent with `redirect_uri_mismatch`, which explains nothing to the person reading it;
   - **the client secret is shown ONCE**, in the dialog that appears the moment the client is created, and
     no page will ever show it again. Tell them to save the ID and the secret into their password manager
     before closing that dialog. Losing it means deleting the client and making another.

2. **`slopweaver drive connect`** — it prints a consent URL, opens it, listens on `127.0.0.1` for the single
   redirect Google sends back, exchanges the code and stores the grant `0600` under
   `$SLOPWEAVER_HOME/secrets/drive-oauth.json`. The socket serves one request and closes.

**A separate consent from the mail door's, deliberately.** Two grant files means revoking Drive access
leaves the mailbox working, `--status` on either door reports only what that door can reach, and the wide
`drive.readonly` scope never appears on a consent screen the owner opened to read their mail. The cost is
one extra browser round trip, paid once.

`--grant` chooses how much to ask for: `metadata` (`drive.metadata.readonly`, the default), `read` (adds
`drive.readonly`) or `write` (adds `drive.file` and `documents`). **The grant records what Google ACTUALLY
approved**, which can be narrower than what was
asked for — the consent screen lets a person untick scopes. When it is narrower, `connect` says so on the
spot, and the verbs needing the missing scope refuse by name rather than failing at the API with a 403 that
explains nothing.

### Which verb needs which scope

| verb                         | scope it needs                                                     | in which `--grant` |
| ---------------------------- | ------------------------------------------------------------------ | ------------------ |
| `drive list`, `drive drives` | `drive.metadata.readonly` (or `drive.readonly`, which subsumes it) | `metadata`         |
| `drive read`                 | `drive.readonly`                                                   | `read`             |
| naming the bound account     | `userinfo.email`                                                   | always requested   |

The `write` grant adds `drive.file` and `documents` to what `read` asks for. No verb in this build needs
either yet — the credential is what the owner approved, and the verbs that use it are the
next step rather than a claim this table should already be making.

Google's rule worth knowing rather than discovering: `drive.readonly` subsumes `drive.metadata.readonly`, so
a `read` grant lists fine. The reverse never holds, and it is the whole point of the narrow grant —
`drive.metadata.readonly` can tell you a file called `Board pack Q3` exists, who owns it and when it
changed, and cannot open it.

Neither READ scope can write, and the write grant is opt-in per consent: an install that never runs
`--grant write` holds a credential that structurally cannot change anything.

`slopweaver drive connect --status` answers "which account, and what may I do with it" with **no browser, no
socket and no network call**. Reach for that, never a fresh consent flow, to check a connection. It reports
the account, the granted scopes and the grant file's path — never token material — and, for a Testing-status
OAuth client, when its refresh token lapses, warning on stderr inside 48 hours of it and once it has passed.
