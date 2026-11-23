# The Clerk atlas is a SURFACE MAP, and its browser half found an API nobody publishes

Part of [Atlases](../atlases.md).

Owner's ruling ([atlas-intent.md](../atlas-intent/06-holdings.md) §6): the who-else-holds-it test decides what
an atlas holds, per platform. Here the entities a Clerk instance holds are the product's own END USERS, whose
record of truth is the application's own database — not this installation and not this atlas. So the
deliverable is the interface, and reading it as an entity index is how a fully covered platform reads as
empty.

MEASURED, reproducible with `slopweaver atlas clerk refresh`: **502 operations over 382 paths and
45 webhook events across four documents pinned at one immutable `clerk/openapi-specs` commit; 38 of 40
declared dashboard pages reached and photographed; 24 distinct first-party operations observed, 16 of which
no pinned document declares.**

**The browser half is why this atlas exists rather than a nicety on top of it.** The dashboard talks to
`dapi.clerk.com` — a Dashboard API that appears in no published Clerk document at all — and ten of its
operations are catalogued, including `/v1/instances/{ins}/domains`, `/v1/instances/{ins}/m2m/settings`
and `/v1/instances/{ins}/webhooks/svix`. That is [atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2's claim paying out
on the first walk: an API-only atlas here would have answered "Clerk offers no way to read that" about a
surface the owner's own browser calls every time the owner opens the page. Read them with
`slopweaver atlas clerk report`, which splits the undocumented set per API so the private dashboard API — all
of which is undocumented by construction — does not swamp a finding about a public one. **Each is a LEAD, not
a capability**: it establishes that Clerk holds the data behind it and says nothing about whether a secret key
may ask for it.

**Three reads return a CREDENTIAL, and finding them is the kind of thing this instrument is for.**
`GET /v1/machines/{machine_id}/secret_key`, `GET /v1/api_keys/{apiKeyID}/secret` and
`GET /v1/users/{user_id}/oauth_access_tokens/{provider}` are ordinary-looking GETs whose 200 body is usable
secret material. They are `excluded` rows naming exactly what comes back, tested ahead of every other rule in
`atlas/clerk/dispositions.ts`, so the atlas can say the operation is THERE without any pass ever calling it.

**Two declared pages are recorded as unreachable, and that is the walk working.** `instance-machines` and
`instance-platform-api-keys` answer 200 and are rewritten by the dashboard client to a different page of the
same instance, which is what it does with a route this account's plan or role cannot open. A crawler would
have reported them as reached; a declared denominator is what makes them nameable
([atlas-intent.md](../atlas-intent/settled-decisions.md) §"Honest about its own gaps").

**Three probes find the instance root, and the third is the one that makes a walk repeatable.** The bare
origin redirects to whatever page the dashboard last showed, so a session last left on the application list is
sent back to it — MEASURED, and it cost a walk 37 of its 40 pages. The application list is server-rendered, so
its own traffic carries neither identifier. The remembered root (`atlas/clerk/instanceRoot.ts`) is therefore
written to the PRIVATE state home the first time any probe succeeds, and `--root` seeds it by hand. No file
means nothing is remembered yet; a file that is there but unreadable, not JSON or not a well-formed root stops
the walk with `CLERK_REMEMBERED_ROOT_UNREADABLE` rather than reading as none, and `--root` overwrites it. The two
identifiers are content under [the partition](../constraints/partition.md): they live under
`$SLOPWEAVER_HOME`, never in this repository, and no verb prints one.

**A bare-origin probe whose navigation fails falls through; nothing else that stops it does.** MEASURED: the
scheduled resync refused on `could not navigate to https://dashboard.clerk.com/: spawnSync
.../node ETIMEDOUT`, a fresh walk the same day succeeded, and the same refusal had stopped a run a week earlier. So a
`NAVIGATION_FAILED` on that one probe prints one identifier-free line on stderr (`clerk dashboard: bare-origin
instance-root probe failed — <because>; trying the application-list probe`) and the walk moves on to the
application list and then the remembered root, in that order. Every run-stopping failure — a lost session, no
transport, an off-lease origin — still refuses before anything else is asked for, and so does an application
list that cannot be reached either: two failed live visits are not one slow page. The fallthrough DEFERS the
refusal rather than cancelling it: when neither the application list nor a remembered root yields one, the
walk refuses with the origin's own `could not reach the Clerk dashboard` line, because a rootless walk
publishes and a probe that never answered is no evidence of a rootless instance. Only an origin that LANDED
rootless answers no root. An application list that settles on a Clerk sign-in wall refuses with the sign-in
line on every path, whether or not the origin fell through and whether or not a root is remembered.

**The instance-api surface is `declared-unfilled` and will stay that way until the owner says otherwise.** No
`clerk-*` entry exists under `$SLOPWEAVER_HOME/secrets`, and every Backend API operation declares
`bearerAuth`. A read-only secret key would fill it; that is a widening of access and the owner's to grant.
