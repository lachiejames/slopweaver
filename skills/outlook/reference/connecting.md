# Connecting Outlook

The owner does two things once. Everything after them is `slopweaver outlook connect`.

## 1. The app registration

**Reuse one before making one.** A registration that already admits personal Microsoft accounts — one made for
an earlier install, or a multi-tenant one that admits work AND personal accounts, whose audience covers the
`/consumers` authority — needs only the **Mobile and desktop applications** platform with redirect
`http://localhost` added (Authentication → Add a platform). Its existing Web redirects and any client secret
it holds are left alone: this door never sends a secret, and Microsoft redeems a code sent to a Mobile and
desktop redirect as a public client. A consent refused with "must contain client_assertion or client_secret" means the `http://localhost` redirect was added under **Web** instead. Then take its client id as below.

For a fresh one, in the Microsoft Entra admin center (`entra.microsoft.com`) → **App registrations** → **New
registration**:

- **Supported account types**: _Personal Microsoft accounts only_ (or work and personal both). The door signs in
  against the `/consumers` authority (`src/live/outlook/authority.ts`), so a registration that admits only work
  accounts fails consent.
- **Redirect URI**: platform **Public client/native (mobile & desktop)**, value `http://localhost`. Microsoft
  accepts any port on a `localhost` redirect for this platform, which is what lets the listener pick a free one.
- **No client secret.** The door is a public client using PKCE; a secret would be a credential with no use.
- **API permissions** → Microsoft Graph → **Delegated**: `User.Read`, `Mail.Read`, `MailboxSettings.Read`,
  `Mail.ReadWrite`, `Mail.Send`, `offline_access`, and `Calendars.Read` if Outlook Calendar is wanted. Personal accounts consent per user at sign-in, so there is no
  admin-consent button to press; listing them makes the consent screen match what the door asks for.

Copy the **Application (client) ID** from the registration's Overview, then:

```bash
slopweaver secrets set outlook-client-id
```

It is an identifier rather than a secret, and it is still kept out of git: it lives in
`$SLOPWEAVER_HOME/secrets/outlook-client-id`, `0600`. `OUTLOOK_CLIENT_ID` in the environment overrides it.

## 2. The consent

```bash
slopweaver outlook connect                 # manage: read, settings, organise and draft
slopweaver outlook connect --grant full    # adds Mail.Send
slopweaver outlook connect --grant read    # reads only
slopweaver outlook-calendar connect        # the calendar: its own consent, User.Read and Calendars.Read only
```

It prints a consent URL, tries to open it, and waits on `localhost` for Microsoft's single redirect. The grant —
the account, the scopes Microsoft actually approved, and MSAL's token cache — is written `0600` to
`$SLOPWEAVER_HOME/secrets/`: the mail grant to `outlook-oauth.json`, the calendar grant to
`outlook-calendar-oauth.json`. Both use the one app registration. Abandoning the page ends the listener rather
than leaving a socket open. `outlook connect --calendar` is refused: the calendar has its own consent.

## What each grant can do

| Grant    | Scopes                                           | Verbs                                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `read`   | `User.Read`, `Mail.Read`, `MailboxSettings.Read` | list, read, triage, measure, folders, categories, attachment |
| `manage` | `read`'s, plus `Mail.ReadWrite`                  | the above, plus mark, category, archive, draft               |
| `full`   | `manage`'s, plus `Mail.Send`                     | the above, plus send                                         |
| calendar | `User.Read`, `Calendars.Read`                    | every `outlook-calendar` verb                                |

No mail tier carries `Calendars.Read`, and the calendar grant carries nothing of the mailbox. Until a calendar
grant is stored, the calendar verbs read through a held mail grant that already carries `Calendars.Read` or
`Calendars.ReadWrite` (one made before the calendar had its own consent); once one is stored, it always wins.
Reconnecting mail on its own drops that calendar permission from the mail grant, and the connect says so when no
calendar grant is stored. The integrations page judges each row by its own grant file alone, so on that older
wider mail grant alone the Outlook Calendar row reads as available, not connected, while the calendar verbs still
read. Every grant also requests `offline_access`, which asks for a refresh token, reaches no data and is never
checked: Microsoft often leaves it out of the scopes a token reports. A verb needing a scope the grant lacks refuses
by name, before any request, and names the one `connect` command that adds it without dropping a permission the
grant already holds. Widening is a fresh `connect` with the wider grant; the old grant is replaced.

## Checking and removing

`slopweaver outlook connect --status` (and `outlook-calendar connect --status` for the calendar grant) prints the
account, scopes and consent instant from the file alone — no browser, no network. `slopweaver connect outlook --check [--json]` is the live preflight onboarding runs: a
`registration` row (is `outlook-client-id` set), an `auth` row (is a grant stored), one row per grant tier
(`read`/`manage`/`send`, a missing tier a warning naming the `--grant` that adds it), and a `read-probe` row —
one `GET /me` through the same silent refresh every verb takes, so it may rewrite the stored MSAL cache, and it
is the only check that sees a consent withdrawn at Microsoft. `--disconnect` deletes the local grant; Microsoft keeps the app's consent until it is
withdrawn at `https://account.live.com/consent/Manage`, which the verb prints.
