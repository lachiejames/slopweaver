# Connecting a Google Calendar

## What you need first, once per machine

A Google Cloud **Desktop app** OAuth client, with the **Google Calendar API enabled on the project**, stored
as two single-line secrets:

```bash
slopweaver secrets set google-client-id
slopweaver secrets set google-client-secret
```

**One client covers the three USER-DATA doors** — mail, Drive and calendar. A Desktop-app client is scoped
to a Cloud project, not to an API, so an install that already connected Gmail has the credential under those
two names. The **Google Admin door is the exception**: it consents through `google-admin-client-id` /
`google-admin-client-secret`, a second Desktop-app client in the same project, because Google merges granted
scopes over the (client, account) pair and only a client never shown a write scope can stay read-only. There is **no fallback to any other name**: no module reads a `gmail-client-id` /
`gmail-client-secret` file, and `slopweaver secrets status` reports both as `dead`. What DOES have to be done
separately is enabling the Calendar API on that project; a client that only ever called Gmail will fail the first calendar read with a
`403 accessNotConfigured` naming the API and the project.

**"Desktop app" is not a preference.** The consent flow redirects to `http://127.0.0.1:<port>` on a port the
kernel picks at run time, and only a Desktop-app client accepts a loopback redirect it was not
pre-registered with. A "Web application" client fails consent with `redirect_uri_mismatch`.

## The consent round trip

```bash
slopweaver calendar connect                   # --grant read: events + the calendar list + the time zone (+ free/busy)
slopweaver calendar connect --grant events    # the narrow event scope only
slopweaver calendar connect --grant meetings  # read + calendar.events.owned, the ONE write scope
slopweaver calendar connect --status          # what is stored, and nothing else
```

**`meetings` is the grant the write verbs need, and it is exactly one scope wider than `read`.**
`calendar.events.owned` creates, changes and cancels events on calendars the account OWNS — the owner's
choice over `calendar.events` (every calendar the owner can write to, shared team ones included) and
`calendar.app.created` (a secondary calendar, which the owner declined). It must ALSO be listed under _Data
access_ on the Cloud project's consent screen before Google will show it; the owner added it there personally. Re-consenting
under `meetings` replaces the stored grant; `--status` then lists the scope.

`connect` binds a loopback listener, opens the browser (and always PRINTS the URL, so a failed opener
degrades to "paste this"), and waits. It serves exactly one request and closes, and tears itself down after
five minutes whether or not anything arrives. Nothing outside the machine can reach it.

**What lands is what Google APPROVED, not what was asked for.** The consent screen lets a scope be unticked,
so the stored grant records the approved set and `connect` warns, per withheld scope, that the verbs needing
it will refuse. A verb whose scope is missing then refuses before the call and names the scope, rather than
failing at the API with a 403 that names nothing.

## The grant, and how to end it

`$SLOPWEAVER_HOME/secrets/calendar-oauth.json`, `0600` under the `0700` secrets directory. It holds a Google
**refresh token** for the bound account and is never printed, logged or synced: `calendar connect --status`
reports the account, the approved scopes and the file's path, and no token material. For a Testing-status
OAuth client it also prints when the refresh token lapses (seven days after consent), and warns on stderr
inside 48 hours of it and once it has passed.

It is a **separate file from the mailbox grant**, and it holds only its own consent screen's scopes: no
consent URL this repo builds sets `include_granted_scopes=true`, which makes a grant file carry the union of
everything the client was ever granted, another door's write scopes among them. A calendar read is
never authenticated by a mailbox grant, and `--status` on one door reports that door's file only.

**Revoking at Google is what actually ends the access**, and `slopweaver calendar connect --revoke` does it
from here: it POSTs the refresh token to Google's revocation endpoint FIRST and deletes the file only once
that succeeded, so a failure leaves a usable credential rather than an invisible one. It is per CLIENT, not
per door — one `--revoke` takes the mail, Drive and calendar grants together, and all three need
re-consenting after it. Deleting the local file by hand stops this machine using the grant and leaves it
standing on the account.

## When it refuses

| refusal                                  | what it means                                          | what fixes it                                          |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `no calendar grant stored for this home` | nothing has been authorised yet                        | `slopweaver calendar connect`                          |
| `the stored calendar grant is missing …` | a scope was unticked, or a narrower `--grant` was used | re-run `connect` and approve it                        |
| `no Google OAuth client is configured`   | the two client secrets are unset                       | `slopweaver secrets set google-client-id` / `…-secret` |
| `Google returned no refresh token`       | this account has already consented to this client      | `slopweaver calendar connect --revoke`, then re-run    |
