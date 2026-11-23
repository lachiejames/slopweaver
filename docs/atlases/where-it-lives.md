# Where it lives, and the one distinction worth holding

Part of [Atlases](../atlases.md).

- **Every verb is DISPATCHED generically; only what a `sync` does is not.** `src/atlas/registry.ts` holds
  one row per platform (`src/atlas/<p>/registration.ts`), and that row is the whole of what a platform
  contributes beyond its descriptor: its `readAdapter.ts` projecting its strict store into `kit/read.ts`'s
  normalized view, its catalogue summary and example, and its OWN verbs — each a name, a usage line, the
  flags the catalogue advertises and a lazy `import()` of the command that runs it (`kit/verbs.ts`). One
  dispatcher (`cli/commands/atlas/platformRun.ts`) serves every platform; the `atlas` noun's manifest
  BUILDS one row per registration (`cli/manifests/atlasPlatformMeta.ts`); `unit/atlas/registryVerbs.test.ts`
  pins each platform's exact verb list and proves every own verb loads. The registry's rows are DERIVED: each is
  the `atlas` feature of an integration manifest (`src/integrations/<id>/integration.ts`), read off
  `src/integrations/registry.ts` in its alphabetical order. So a new atlas is a descriptor, a read adapter, a
  registration and its integration's manifest naming it — no `*Platform.ts`, no manifest row, no `helpTruth`
  opt-out, no test file of its own. Before this (an owner ruling) 31 hand-wired platform files carried 88
  if-verb branches and nine manifest files restated every verb list a third time; at the owner's stated direction
  of about a hundred atlases those branches become roughly 300. Each atlas still keeps its own `sync`,
  because what it takes to ACQUIRE a platform is exactly the part that is not shared. Before the kit verbs
  an atlas could only be read with `jq` over `$SLOPWEAVER_HOME` — five thousand synced Cloudflare
  entities, reachable by no verb — which is not what [atlas-intent.md](../atlas-intent/settled-decisions.md#properties-the-owner-has-ruled-on-that-a-kit-must-not-un-decide) means by
  turning an atlas into verbs so it is easy for the AI to call.

- **`reset` is the one CONDITIONAL kit verb, and a platform declares it rather than implementing it.** The
  other four are unconditional; `reset` is answered only by a registration carrying `readReset`, so
  `kit/verbs.ts`'s `atlasKitVerbsFor({ hasReset })` is the list to ask and `ATLAS_KIT_VERBS` is never it.
  Three atlases reset through their own top-level noun (`slopweaver cloudflare reset`, `crowdstrike`,
  `onepassword`), which is what makes the verb conditional at all. Slack's `slopweaver atlas slack reset`
  is the remedy its store prints on a refused generation, and it stamps the INSTALLED SDK version into its
  empty manifest (`src/atlas/slackApi/atlasReset.ts`) so the next publish clears the major guard. What a
  platform owns is the EMPTY generation it installs — its kind files, its initial manifest, its store spec
  and where its paths resolve — and `kit/reset.ts`'s `atlasResetFor` binds those four into the closure `readReset` hands back; the argv tail, the `--confirm archive` guard, both output
  shapes and the exit codes are `cli/commands/atlas/resetRunCore.ts`'s, and `cli/commands/atlas/resetRun.ts`
  is the single shell that resolves the platform. The class this replaces is 33 platforms declaring `reset`
  as an OWN verb: each carried an `atlas/<p>/reset.ts` naming four exports it already had, a
  `cli/commands/<p>Atlas/resetRun.ts` that was the same CLI wiring with three names swapped, and a usage
  constant that was one sentence with the platform name swapped — copies that differed nowhere a reader
  could act on, which is why the usage line is DERIVED by `atlasResetUsage`. Count what has moved with
  `grep -c readReset src/atlas/*/registration.ts | grep -vc ":0"` against `ls src/atlas/*/reset.ts | wc -l`;
  the remainder is the `fold-atlas-reset-rest-291-54` board row, converted the same way. The registration's thunk
  must stay a thunk: a static `import` of the platform's own model or store module, or of the kit's reset
  module, at the top of a
  `registration.ts` makes every unrelated verb pay for that platform's whole model and NOTHING FAILS, so
  `unit/atlas/registrationLaziness.test.ts` asserts every top-level import there is `import type`.

- **`render` is the one THE OWNER reads**, and it exists because of a steer: the owner would have
  noticed something was wrong much sooner by seeing what was in the atlas with their own eyes. It emits ONE self-contained HTML page — every defect visible without expanding anything, every
  detail behind a `<details>` — and `--fragment` emits the form a Claude Artifact takes, so a resync can
  republish the page it already has. Its headline is the question the owner asked for by name: **which endpoints and
  URLs exist that were never hit.** `kit/pageReachability.ts` answers it per KIND, treating a FILLED
  `compiled` surface as the provider's own statement of what exists, and reports `?` rather than `0` wherever
  no such surface stands — because a page that counted only what it touched would report every API-only atlas
  as fully covered. MEASURED the day it landed, over the 23 readable generations: **21 report `absent`**,
  google-admin reports 414 declared-and-never-reached, trelica 27. Re-derive with
  `slopweaver atlas <platform> render --json | jq .reachability`.

- **`src/atlas/`** — the synced atlases. `atlasFile.ts` is the shared generation-and-archive file format
  and `kit/` the generation protocol every atlas publishes and is read back through; `slack.ts`,
  `slackApi/`, `cloudflare/`, `vanta/`, `onepassword/`, `crowdstrike/`, `notion/`, `jumpcloud/`,
  `datadog/`, `trelica/`, `graphqlHive/`, `github/`, `microsoft365/`, `nxCloud/`,
  `nightfall/`, `linear/`, `xero/`, `workos/`, `airtable/`, `figma/`, `geminiAiStudio/`, `braze/` and `twilio/` are the syncs.
  `kit/compiledSync.ts` is the half the two specification-compiling atlases share — the census assertion,
  the kind index, the disposition count, the shared rechecks and the kind-file build — extracted the day the
  clone ratchet caught them as a pair rather than by raising its floor. There is one more MODULE than there
  are atlases: `kit/contract.ts` makes
  one PLATFORM per atlas a type, so the Slack workspace, the Slack Web API and the Slack web client are
  SURFACES of one Slack atlas. A platform appearing twice in the catalogue is the failure that shape exists
  to prevent. Enumerate what this build actually has with `slopweaver catalog` rather than from this
  sentence. `jumpcloud/` syncs its `directory-api` surface and walks its `admin-console` surface into a separate
  console generation (`atlas/jumpcloud/console/`), because the API manifest is an exhaustive record over the
  registry's kinds. Neither surface's status is a literal a reader ever sees — `surfaceFill.ts` derives the
  API one from the manifest against an exact invariant (every applicable kind is accounted for: a recorded
  success, which a kind whose only failures were the provider's own 404, 501 or per-record answers earns, or a
  whole-kind permission boundary or product absence stamped from typed failures) and the console one from the
  latest walk (every declared page reached and photographed), because a static `filled` is filled on every
  install including one where the sync or walk never ran.
  `datadog/` publishes its `compiled-catalogue` surface from a registry committed to this
  repository and leaves `api` and `console` `declared-unfilled`, each with a per-kind coverage cell naming
  what it waits on: `api` needs a live pass over the registry's 654 entity and 90 shape-index operations
  (329 of the entity ones take no path parameter and are the tractable half), and `console` is blocked on a
  DENOMINATOR rather than on a transport — Datadog publishes 43
  command-palette page routes and no sitemap, and a walk against that subset is what the owner ruled out.
  Its `surfaceFill.ts` denominator has no exception in it, unlike Microsoft 365's: every Datadog kind exists
  because the registry carries rows for it, so one compile fills all 144 or the compile is broken.
- **`airtable/` is the first atlas here whose authority is a document nobody ships as a file.** Airtable
  publishes no OpenAPI download, no versioned SDK covering its whole Web API, and no `openapi.json` at any
  address — measured, and recorded in `generated/specLock.ts`. What it does publish is the complete
  document server-rendered into every page of its own reference, at `window.initData.openApi`, and that is
  what `tools/generateAirtableSurfaces.ts` extracts, digests and censuses into a committed registry. So its
  generator reaches the network where Datadog's reads `node_modules`, and the registry it writes is
  committed for exactly that reason: `atlas airtable sync` then publishes with no request and no credential.
  Two findings fell out of the census before any account existed — Airtable declares a `workflow` tag (its
  own noun for automations) and ships **zero** operations under it, so no REST call reaches a base's
  automations at all; and **64 of the 103 operations still accept the deprecated user API key**, so a legacy
  integration holding one reaches two thirds of this surface.

- **`airtable/`'s browser route inventory is MEASURED rather than recalled, and that is a method worth
  reusing.** Airtable answers an unauthenticated request to a gated route that EXISTS with
  `302 → /login?continue=<route>` and one that does not with a flat `404`, so 11 routes — the whole account
  and enterprise-admin surface — have their existence confirmed with no Airtable account in the world.
  `tools/probeAirtableRoutes.ts --verify` re-measures it, and refuses outright if its control route stops
  answering 404, because a probe whose negative has stopped firing is measuring nothing. A `200` is recorded
  as `shell-200-ambiguous`, never as existence: Airtable's single-page shell renders 200 for a signed-out
  visitor at `/{baseId}` with an invented base id. **Every entity kind is empty and none of them is empty
  because of Airtable** — this account is not a member of the organisation's Airtable enterprise, its own
  SSO tile answers "That account does not have access", and each kind's `not-configured` cell names the
  invite as the unblock.

- **`figma/` is where the browser half stops being a second opinion and becomes the only way in.** Every
  other atlas here uses the browser to catch a settings page the API forgot. Figma's REST document — its own
  `@figma/rest-api-spec`, pinned by both a tarball digest and an `openapi.yaml` digest — has **no operation
  that returns the set of teams or organisations a credential can see.** Its whole `Users` tag is
  `GET /v1/me`, which describes the caller and lists nothing, so every team-scoped operation in the document
  needs a `team_id` that only a browser URL supplies. Neither is there an operation for a membership, a role,
  an organisation setting, an installed plugin or the trash, and the document names three OAuth endpoints it
  declares no path for. That is [atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2 arriving as a measured property of a
  platform rather than as a principle, and it is why `browser-walk` is declared rather than dropped for want
  of a credential.

- **`figma/`'s route probe grades a redirect against an INVENTED SIBLING, and that is the sharper version of
  Airtable's method.** Figma's sign-in gate refuses before its router resolves the leaf, so
  `/files/team/{teamId}/zzz-not-a-real-subroute` answers exactly what `/files/team/{teamId}/members` answers
  — a redirect alone confirms the gated PREFIX and nothing after it. `tools/probeFigmaRoutes.ts` therefore
  spends a second request whose whole job is to fail: an invented sibling for a route ending in a literal,
  and the redirect's own `resource_type` parameter for one ending in a parameter. It caught a real over-claim
  in `browserPages.ts`'s first draft, where six team sub-routes were graded as confirmed by the file that had
  produced them. Two rows record a probed ABSENCE — Figma has no `/admin` — because a reader who guesses one
  should learn it from the atlas rather than from a browser.

- **Two findings fall out of Figma's census before any credential exists.** All three operations under the
  `Projects` tag carry `deprecated: true`, so a whole declared surface has been retired in place — and the
  browser corroborates the succession from the other side, since `/files/project/{projectId}` answers
  `resource_type=folder` on its sign-in redirect, which is the v2 `Folders` vocabulary for the noun the v1
  API still calls a project. Neither surface states that on its own, which is
  [atlas-intent.md](../atlas-intent/04-corroboration.md) §4's corroboration producing a finding. And exactly **one** of the 54
  operations accepts an organisation-scoped OAuth grant, so an org-level integration can read the activity
  log and nothing else at all.

- **`kit/projection.ts` and `kit/withheld.ts` are kit-owned because they were copied.** The storage-boundary
  walk — RFC 6901 pointer escaping, the depth bound, the drop report, the withholding summary — lived twice
  before the Datadog atlas made it three times and the clone ratchet refused it. It is the hand-rolled-
  `Result` family again: a shape that regenerates through ordinary careful work, because the next atlas's
  author opens whichever sibling they find first. Each platform contributes only its own denial
  function, and `AtlasDenialReason` (`secret-material` / `ephemeral-token`) is kit-owned and CLOSED on the
  same argument `ATLAS_COVERAGE_STATES` is.
  `kit/contract.ts`'s `compiledSurfaceMapSurfaces()` joined them for the same reason on the same evidence:
  the Airtable and Figma descriptors declared byte-identical `spec-declared` and `browser-routes` entries —
  both `compiled`, both `filled` with nothing configured — and the clone ratchet is what said so.
  `graphqlHive/` is the first to fill a surface on the commit that lands it: its `registry-graphql-schema`
  surface needs no credential at all, so one introspection publishes the whole callable API in a single
  request, while `registry-content` stays `declared-unfilled` and names the token and organisation slug it
  needs. The kit's compare-and-swap, its publish lock and its verified artifact writer moved there in the
  same change, for the reason the bullet below gives: the second atlas to need one is where a copy gets
  made.
- **Inside `slackApi/`, two files hold browser-observed rows and only one of them is a SURFACE.**
  `browser.ts` is generated from a hand-saved HAR — real data, and exactly the acquisition `kit/contract.ts`
  refuses to name, because a surface must not claim `filled` "on the strength of a file somebody made once".
  `drivenBrowser.ts` is the surface: an agent drives a visible browser through one command that can be run
  again tomorrow. Reading the first as the second is the mistake this bullet exists to prevent.
- **A GraphQL provider's surface map is ONE request, and the Hive atlas is where that shows.** A REST atlas
  enumerates paths; a GraphQL one asks the server to enumerate itself, so `atlas graphql-hive sync` gets
  every root field, argument and named type from a single `__schema` query — and it cannot drift from the
  running server, because the running server is what answered. MEASURED against
  `api.graphql-hive.com/graphql` with **no credential at all**: 26 root fields and 257 named types. That is
  also why the atlas's API half splits into two surfaces rather than one: the schema needs no token and the
  registry's CONTENT needs both a token and an organisation slug, because Hive's public API declares no list
  field of any kind — its three root Query fields each take a reference, so nothing can be enumerated.
  Reproduce with `slopweaver atlas graphql-hive read --kind operation`.

- **A REST provider can enumerate itself too, if it distinguishes its own 404s — and WorkOS does.** WorkOS
  serves no OpenAPI document (`api.workos.com/openapi.json` and `workos.com/docs/openapi.json` both 404,
  measured), so there is no vendor spec to compile. What there IS, is an oracle: the running API
  answers `401 {"message":"Unauthorized"}` for a route it serves and a distinguishable `404` for a pair it
  does not, so every route's EXISTENCE is measurable with **no credential at all**. MEASURED: 67
  candidate pairs probed, **51 proved present** and **16 proved not routed**, across six distinct verdicts —
  and two of the present ones hand back their own parameter NAMES for free (`POST /sso/token` names
  `client_id`, `client_secret`, `code`, `grant_type`; `POST /user_management/authenticate` names
  `client_id`). Reproduce with `slopweaver atlas workos read --kind operation --limit 200`.

  Three things about that are worth carrying to the next REST atlas rather than left in one module.
  **The denominator is local and the atlas SAYS so**: with no vendor document the set of routes ASKED about
  is a table in this repository, so `route-denominator-is-local` is a standing gap on every run — every
  verdict is the server's, and a route nobody here named is simply never probed. **The negative is one-way**:
  `POST /directory_users` and `POST /zzz_nope` return the byte-identical `Cannot POST <path>`, so an `absent`
  row is a fact about a PAIR and never about a path. And **the oracle checks itself**: each run probes a
  control path that cannot exist and refuses to publish anything at all if the server fails to call it
  absent, because a WorkOS that started answering `401` to everything would otherwise fill the atlas with
  routes that do not exist and nothing would notice.

- **WorkOS is also where the two surfaces differ in what can be KNOWN, not just in what they hold.** The API
  half is measurable without a credential; the dashboard half is not measurable at all without a session.
  MEASURED: `/organizations`, `/api-keys`, `/directory-sync` and a deliberately nonsense
  `/zzz_nope` ALL answer the same `307 → /signin?redirect=<path>`, so the sign-in redirect is a catch-all
  and an unauthenticated prober cannot tell a real dashboard page from an invented one. That is why the page
  map is `compiled` and its walk is a separate surface, and why `dashboard-route-unverifiable-without-session`
  is a standing gap rather than a missing run. The one address the vendor corroborates for free is
  `/settings`, which redirects to `/settings/team` with or without a session. The walk's brief therefore
  opens by asking the session to confirm it is signed in, and `parseWorkosWalkDocument` REFUSES a document
  that says it was not: an unsigned walk lands on `/signin` fourteen times and would publish fourteen
  unreachable pages as a finding about WorkOS when it is a finding about the session.

  **The strongest evidence for that claim is what the first signed-in walk found, and it is the reason to
  take one.** MEASURED: eight of the fourteen addresses the table then declared were stale,
  because the dashboard had moved almost every surface under a per-workspace `/environment_<id>/` segment.
  Nothing the anonymous measurement above could see says so — a catch-all sign-in redirect answers a moved
  address exactly as it answers a live one — and an ANONYMOUS prober would have gone on reporting the page
  map healthy indefinitely. So the environment segment is resolved at runtime from `$SLOPWEAVER_HOME` rather
  than written down (`src/atlas/workos/environmentId.ts`): the walk's own witnessed `finalUrl` is what
  reveals it, since WorkOS redirects the bare `/api-keys` and `/webhooks` into the scoped address, and an
  install that has never walked publishes those bare paths as a declared BOOTSTRAP under
  `dashboard-environment-unresolved`. Two of the eight had MOVED rather than been rescoped — `/redirects`
  now lands on the environment's `/applications`, and `/sso` renders at no address this atlas has witnessed,
  which is `dashboard-surface-moved-unknown-address` rather than an invented row.
  `datadog shot` is the odd one out on that table and the difference is worth stating: the other four reach
  Datadog with the two keys (`datadog-api-key`/`datadog-app-key` in the store, or `DD_API_KEY`/`DD_APP_KEY`)
  and return data, while `shot` reaches the CONSOLE with a signed-in browser session and returns a PNG. It needs
  the site (`profile.json`'s `datadog.site`, or `DD_SITE`) and neither key. See
  [security/browser-write-surface.md](../security/browser-write-surface.md#the-browser-is-a-write-surface-and-is-gated-as-one) for why that browser lane is
  the door rather than a way around one.

- **`src/datadog/` and `src/atlas/datadog/` are two different things, and the distinction survived the
  atlas landing.** `src/atlas/datadog/` is the atlas: a closed operation registry, a field-denial
  projection, a pre-publish gate wired into the kit's own `guardPublish`, and a coverage seam.
  `src/datadog/` is still a peer rather than a tenant — a platform client library (query building, citation
  links, aggregation, rate-limit budgeting, the `shot` image lane) that a caller's own investigation logic
  builds on. **Nothing under `src/datadog/` produces an atlas file**, and `slopweaver datadog raw` remains
  outside the atlas's closed acquisition registry on purpose: the registry bounds what the ATLAS may call
  while publishing a generation, and `raw` is an investigation verb with its own read-only enforcement, its
  own POST allowlist and no generation to publish into.
