# The Google Admin atlas maps the console, and the scope is the fact the map is FOR

Part of [Atlases](../atlases.md).

It is a SURFACE MAP on the §6 test, and the test is not close here. The corpus holds the people; the Gmail,
Drive and Calendar doors each hold their own half of what this account contains, under their own grants.
What nothing holds is the Admin CONSOLE — which pages exist, which method reaches the same fact, and which
administrator scope a caller would have to be granted first. So `directory-users` holds eleven methods and
one `User` schema, and it holds no users.

**Eleven documents were selected from Google's 528, by a criterion that is computable and one judgement
that is not.** The criterion — in `atlas/googleAdmin/apiSelection.ts` and quoted verbatim by the descriptor,
so the two cannot drift — is that every OAuth scope the API declares, other than the generic
`cloud-platform` catch-all, is an administrator scope. It selects twelve; `reseller.v1` is then dropped by a
stated judgement, because `apps.order` administers a customer a reseller sells to rather than this account.
The six near misses are RECORDED with their reasons rather than dropped, and two of them cost a real
console page, so `gaps.ts` raises `adjacent-api-unmapped` instead of leaving a reader to notice. That count
is asserted against the code by `apiSelection.test.ts` rather than left to a reader — a Codex review pass
caught this very sentence saying three while the code derived two.

Reproduce the whole pin — the index and every document — in one command:

```bash
yarn tsx tools/generateGoogleAdminSurfaces.ts --fetch /tmp/google-admin-specs
```

| Disposition   | Rows | What it means here                                                                                                      |
| ------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `entity`      | 128  | reads this atlas would call and store — the directory, the devices, the roles, the policies, the Vault matters          |
| `shape-index` | 28   | the audit log, the usage reports, the telemetry events, the Chrome fleet reports, the alerts and the browsing summaries |
| `probe-only`  | 0    | Google publishes no credential-validation method in these eleven, so a caller learns its grant works by reading a 403   |
| `excluded`    | 180  | inventoried and never called — 175 writes, 3 `watch` subscriptions, 2 media uploads                                     |

**The obvious computable read/write rule is WRONG here, and being wrong about it is what a scope is for.**
Deriving read-versus-write from a declared `.readonly` scope misclassifies nine non-GET methods and is
wrong about six: the three `watch` methods register a push channel under readonly scopes, `admin.channels.stop`
deletes one, and `chromemanagement…notificationConfigs.create`/`.delete` create and delete stored
configuration while declaring **only** `chrome.management.telemetry.readonly`. So the rule is inverted — GET
is a read, every other method is a write unless one of three named rows says otherwise — and the
misdeclarations become a `readonly-scope-grants-a-write` gap rather than a silent widening of what the atlas
would call. An administrator granting a readonly-sounding scope believing it cannot write is granting more
than they think.

**Google's own method id is not unique, and the same finding appears twice.** Across the eleven documents
there are 336 methods and 335 distinct ids: `admin.channels.stop` is declared once in `admin.directory_v1`
and once in `admin.reports_v1`, with a different scope set each time — and the readonly-scope gap fires on
the `reports` copy and not the `directory` one. Keying on the id alone would have folded the two and lost a
scope set, which is why the provider key is `<document>:<id>`.

**Nineteen methods declare no scope at all**, every `chromemanagement` connector-config, certificate-provisioning
and long-running-operation method and every `cloudidentity` user-invitation method. A caller reading the
document alone cannot construct a consent request for any of them, so the console is what reaches those
surfaces — recorded as `undeclared-scope` rather than left to read as "no scope needed".

**The browser surface is gated by the platform rather than by this installation.** The Admin console
re-verifies a signed-in administrator with Google's step-up challenge, asking for a password before it will
render a page, so a session with valid cookies can still land on `/ac/home`'s challenge. That is the console
re-verifying rather than a missing session or a wrong profile, and nothing here may enter a password; the
challenge is cleared by a person, and a walk then runs in that browser: **10 pages opened and judged loaded, 47
distinct routes seen linked.** It is a property every future walk of this console has to plan around, so it stays in
the descriptor with the measurement in it rather than as a note.

**Its cell is `deferred` and always will be, for two reasons more walking does not fix.** Google publishes
no route inventory for this console and no sitemap carrying one, so the denominator is what the console
itself linked — the page list is a FLOOR, which `console-inventory-is-observed` says permanently. And this
browser route returns an image to the model rather than a file a verb reads back
([browser-route](../browser-route/brief-profile-and-walks.md#what-a-brief-can-and-cannot-ask-for-measured)), so no page carries a screenshot and each says `reached but not
photographed`. A `synced` cell would claim a completeness the platform does not offer.

**Every route is normalised before anything is stored, and the rule is general rather than a list.** One
page of this console renders a link per person in the directory. The first reduction named four id-bearing
families by hand and missed three the first walk actually produced, so `consoleRoute.ts` replaces any
SEGMENT that is not a word somebody chose, wherever it sits, and the walk verb re-normalises rather than
trusting its brief was followed. It errs toward replacing on purpose: a route reading `{id}` where a word
stood costs a reader one lookup, and a person's identifier on disk costs what the whole hygiene rule exists
to prevent.

**The API surface is still `declared-unfilled`, for an unrelated reason.**
`slopweaver drive connect --status` prints a grant carrying only end-user Gmail and Drive scopes, so
`admin-api` would answer 403 on every method. A consent round trip under an account holding an admin role
fills it.
