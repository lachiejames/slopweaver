# The Prisma Data Platform atlas found its own specification in an error message, and its browser is a blind wall

Part of [Atlases](../atlases.md).

Nothing else in this installation holds a Prisma workspace, project, database, connection string, backup,
bucket or service token, so by [atlas-intent.md](../atlas-intent/06-holdings.md) §6's own test this atlas holds
**everything reachable, entities included** — twenty-three entity kinds beside its three surface-map ones.
Every one of the twenty-three is empty today, and for a credential reason rather than a Prisma one: MEASURED,
the secrets store under `$SLOPWEAVER_HOME` carries 22 values and no Prisma one, and nothing is
set in the environment. Four things about it are worth stating.

**The machine-readable description of this platform is served to anybody, and nothing links to it.** Four
guessed addresses answered 404 (`api.prisma.io/v1/swagger.json`, `/v1/openapi.json`, `/openapi.json`,
`www.prisma.io/docs/rest-api.json`); what found it was the `hint` on a 422 the API itself returns —
_"Check the request body against the API docs at GET /v1/doc"_ — and that address answers an OpenAPI 3.1.0
document of **115 operations across 72 paths, with 78 query, 128 path and 11 header parameters, 39 request
bodies carrying 143 field paths, and 499 declared responses carrying 3,051 response field paths**. That is
[atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2's unknown-unknowns argument arriving before the atlas existed. It is
pinned by digest in `src/atlas/prismaDataPlatform/generated/specLock.ts`; because the URL serves whatever
Prisma is running now rather than a release, the generator refuses on a moved digest and distinguishes a
digest-only move from a census move, and nothing a user runs fetches it at all.

**Seventy of the 115 operations are documented nowhere, and the partition is exact.** The operations
`www.prisma.io/docs/rest-api/endpoints/` publishes a page for are precisely the 45 carrying no
`x-prisma-stability` extension; the 70 marked `experimental` have no page at all, with **zero overlap in
either direction** — a fact computed from two independent sources, the document's own extension and the docs
sitemap, so it is falsifiable rather than assumed, and the generator refuses if either count moves. What is
undocumented is the whole **Prisma Compute** product: services, deployments, builds, branches, custom
domains, environment variables, SCM installations, source repositories and a twelve-operation infrastructure-
state store. A reader working from the documentation would conclude this is a Postgres management API.

**All 54 declared GETs were confirmed to EXIST with no credential, and none was absent.** `api.prisma.io`
answers `404 resource-not-found` to an invented path and `401` or `422` to a real one, so an unauthenticated
probe separates the two — against three controls at three depths, all of which answered 404. Forty-five
answered 401, eight answered 422 naming a parameter the document already declares required, and one answered
`200`. That one is the atlas's sharpest corroboration finding and it is a self-contradiction:
`GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/version` inherits the document root's
`security` — which states a credential is required — while its own `description` calls it an unauthenticated
contract-version probe, and the live service sides with the description, returning `{"version":5}` for two
different synthetic ids. The prose and the service agree; only the machine-readable half is wrong. The gap is
RECORDED rather than resolved, because which surface wins is the owner's call
([atlas-intent.md](../atlas-intent/04-corroboration.md) §4). The 61 mutating operations were never requested at all — an
anonymous `DELETE` sent to find out whether a route exists is a write attempt whatever it returns — so they
carry `unprobed-mutating` rather than a silence.

**The browser half is the side that cannot be mapped, which is the reverse of the usual shape.** On Figma the
API cannot enumerate its own root and the browser is the only way in; here the API is complete and
`console.prisma.io` is a blind wall. MEASURED: fifteen candidate paths — `/settings`, `/workspaces`,
`/admin`, `/account`, and even `/robots.txt` and `/sitemap.xml` — answer the identical `302 → /login` that an
invented control answers, so the authentication gate sits in front of the router and a signed-out probe
establishes nothing. The application's own route manifest agrees, and it is what turns that inference into a
measurement: the console is a React Router application and embeds `window.__reactRouterManifest` in the page
it serves a signed-out visitor, declaring **four entries and two addressable paths**. So the atlas declares
the three routes it established — `/` by the manifest, `/login` at 200, `/logout` at a distinguishable
`400 application/json` — keeps the fifteen candidates as candidates rather than promoting them on the
control's own evidence, grades the surface `unreadable` rather than `synced`, and opens a permanent
`console-origin-indiscriminate` gap. The browser surface has not shrunk; it has said, with evidence, that it
needs a signed-in walk, and the work profile is not signed in — which is a card for the owner, never a
credential a session types.

**A third surface neither of the other two declares a path for.** `auth.prisma.io` publishes an RFC 8414
metadata document that nothing links to, naming a JWKS and an OAuth **dynamic client registration** endpoint
no Prisma documentation mentions. Unlike the console, this origin discriminates, so all nine rows are
measured against a 404 control: six confirmed, three confirmed ABSENT — and the absences are the useful half.
There is no OpenID Connect discovery document and no `/userinfo`, so this platform is OAuth 2.0 without an
identity layer, and a reader learns that from the atlas rather than from a failed integration.

**Two smaller findings worth keeping.** `Buckets` — Prisma's whole S3-compatible object-storage surface,
seven operations — is carried by those operations and declared in the document's root `tags` array nowhere,
the inverse of the Figma registry's declared-but-unserved case; a reader building a product-area map from
`tags` would omit object storage entirely. And the read surface is almost secret-free by Prisma's own design:
`connectionString` appears in six responses and **not one of them is a GET**, `GET /v1/environment-variables`
returns a variable's `key` and a `valueKid` and never its value, and the one credential field a read can
return — `directConnection.pass` — sits on an object the document already marks deprecated. `sensitiveFields.ts`
names it by PATH rather than by name, because on this platform `url` is the public self-link of 101 response
properties and `key` is an environment variable's own name.

**One gap is about an organisation's inventory rather than about Prisma's API.** When a SaaS-discovery
inventory and a managed-vendor register disagree about whether Prisma is tracked, the `workspace` gap records
the question and the two commands that answer it (`slopweaver atlas trelica read --kind app --query prisma`
and `slopweaver atlas vanta read --kind vendor --query prisma`) rather than a count, because a count would
become stale when the register changes. This atlas cannot close it; it is here because nothing else in an
installation would say it.
