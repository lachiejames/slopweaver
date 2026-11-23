# Atlases — the local map of what a platform CONTAINS

**The definition an atlas has to satisfy is [atlas-intent.md](./atlas-intent.md)** — the owner's own
words, consolidated, including the rule that an atlas spans BOTH the API surface and the browser surface,
because they diverge. Read it before proposing an atlas design. **Slack meets it**, and CrowdStrike, Vanta,
Notion, Trelica, GitHub, Nx Cloud, Linear, Clerk,
Twilio, Hex, Google Admin and Jam fill a real `driven-browser` surface of their own. Cloudflare, 1Password,
JumpCloud, Datadog, GraphQL Hive, Microsoft 365, WorkOS, Gemini / AI Studio, Braze
and the Prisma Data Platform have not, and each SAYS so through a
`declared-unfilled` surface rather than
through a silence — check which is which with `slopweaver atlas <platform> coverage` rather than from this
sentence, because a sentence here is the thing that goes stale.

**What an atlas HOLDS is per-platform, on the owner's ruling** ([atlas-intent.md](./atlas-intent/06-holdings.md)
§6), and this page's own contents only make sense read through it: where something better suited already
holds a platform's entities, the atlas holds the SURFACE MAP alone — pages, endpoints, methods, fields and
the URL that proves each. Where nothing else holds them, the atlas holds everything reachable, entities
included, minus the highly voluminous. **Gemini / AI Studio comes out the SURFACE-MAP way, and it is the case
the test was built for**: what this organisation actually has of Gemini is a Google
Workspace fact — who is licensed, which admin policies govern it, what the console reports as usage — so the
Google Admin atlas is the row better suited to reach it, and this one maps the interface and names that
holder on a `held-elsewhere` cell. **That holder is a surface map too**, so it says where each
of those lives and which administrator scope reaches it rather than holding the records, and the Gemini
atlas's `entities-holder-is-a-surface-map` gap is permanently open saying exactly that. **So the Slack atlas holding no channel, person or usergroup is
correct rather than incomplete** — the corpus holds those, its `page` kind carries a `held-elsewhere`
coverage cell naming it, and reading its surface map as an entity index is how a fully covered platform
looks empty. **Canva is the surface map for a DIFFERENT reason and the
difference matters**: §6's test comes out "everything reachable" there, because nothing else holds a design
or a folder, and what is reachable with no integration registered is the published description alone. So
the atlas holds the map, declares the two entity-bearing channels unfilled, and mints no kind for records
nothing can fetch. Cloudflare, Vanta, 1Password, JumpCloud, CrowdStrike, Datadog,
Trelica, GraphQL Hive, Microsoft 365, Nx Cloud, Xero, WorkOS, Braze, Twilio, Jam and the Prisma Data Platform
are the other case and hold their entities.
**Hex is the one row where the test comes out "everything reachable" and the atlas holds the surface map
anyway, on a CONSTRAINT rather than a holder.** Nothing else here holds a Hex project, so §6 alone would send
it the other way; the owner put the platform back in scope with the explicit care that it store
no customer data locally, and a Hex project is a notebook over the organisation's warehouse. So it mints a
THIRD disposition — `withheld` beside `entity` and `shape-index` — for the operations whose response is or
renders a query result, and it is the only atlas here that refuses a captured body's field NAMES as well as
its values, because on a data workspace those names are the warehouse's own column names. Its own section
below carries the criterion. **Clerk is the Slack case reached from a different direction**: the entities behind its operations are the
product's own end users, whose record of truth is the application's own database rather than anything here,
so its atlas maps the interface and holds no end-user row. Hive is the
clearest case of a surface nothing else touches: nothing anywhere in this installation holds a schema
registry, so its organisations, projects, targets and composed schemas are the atlas's own. Xero is
where the BOUND matters most: nothing else holds the books, and its general ledger and bank-feed lines are
the voluminous class the ruling carves out. WorkOS is the one worth reading beside them, because the
JumpCloud atlas looks like it holds WorkOS and does not. What JumpCloud holds is an ACCOUNT record saying
this person has a WorkOS login, which is a fact about JumpCloud. Nothing anywhere holds a WorkOS
organisation, user, SSO connection or SCIM directory, so those are the WorkOS atlas's own.

## Shared contracts

- [Definition of done: an atlas is not done until it ANSWERS](./atlases/definition-of-done.md)
- [The nouns](./atlases/nouns.md)
- [Where it lives, and the one distinction worth holding](./atlases/where-it-lives.md)
- [What atlases do NOT do](./atlases/what-atlases-do-not-do.md)
- [Publication fails closed, and what that does and does not mean](./atlases/publication.md)
- [A sync is a SOFT RECONCILE; `reset` is the hard one, and it is reversible](./atlases/sync-and-reset.md)
- [A capability row READS the generation instead of declaring what it holds](./atlases/capability-rows.md)

## Platform records

- [The GitHub atlas is a SURFACE MAP, and it declares no entity kind at all](./atlases/github.md)
- [The Linear atlas is a SURFACE MAP, not a second copy of the corpus](./atlases/linear.md)
- [The 1Password atlas holds no secret, as a property rather than a promise](./atlases/onepassword.md)
- [The Notion atlas is a SURFACE MAP, and the pages it wanted have no URLs](./atlases/notion.md)
- [The Xero atlas holds EVERYTHING REACHABLE, and declares the ledger rather than storing it](./atlases/xero.md)
- [The Clerk atlas is a SURFACE MAP, and its browser half found an API nobody publishes](./atlases/clerk.md)
- [The Trelica atlas holds the entities, and its three surfaces have three different keys](./atlases/trelica.md)
- [The Nx Cloud atlas holds everything reachable, and DECLARES the run history it does not hold](./atlases/nx-cloud.md)
- [The CrowdStrike atlas changes nothing, as a property of the CREDENTIAL rather than of the code](./atlases/crowdstrike.md)
- [The Datadog atlas is bounded by a DISPOSITION table, not by an allowlist alone](./atlases/datadog.md)
- [The Braze atlas is the first here whose two FILLED surfaces are both published documents](./atlases/braze.md)
- [The Microsoft 365 / Entra atlas maps the largest surface here, and has read no tenant](./atlases/microsoft-365.md)
- [The Nightfall DLP atlas is the one whose compiled surface is its whole deliverable today](./atlases/nightfall.md)
- [The Gemini / AI Studio atlas is a SURFACE MAP, and it names the store that holds its entities](./atlases/gemini-ai-studio.md)
- [The Twilio atlas maps a product nothing else here touches, and its last blocked surface is blocked on a WRITE](./atlases/twilio.md)
- [The Google Admin atlas maps the console, and the scope is the fact the map is FOR](./atlases/google-admin.md)
- [The Google SecOps atlas reads one Chronicle instance, and nothing it holds can write](./atlases/google-secops.md)
- [The Canva atlas is where the vendor's own PROSE carries the reachability contract](./atlases/canva.md)
- [The Jam atlas maps a product whose PUBLISHED API returns none of its own nouns](./atlases/jam.md)
- [The Prisma Data Platform atlas found its own specification in an error message, and its browser is a blind wall](./atlases/prisma-data-platform.md)
- [The Hex atlas is a SURFACE MAP because of a CONSTRAINT, and it is the first here to withhold a shape](./atlases/hex.md)
- [The Knock atlas maps a platform with TWO published APIs, and a third of its product pages have neither](./atlases/knock.md)
- [The Inngest atlas gets its route table from the vendor, and its GraphQL surface from nobody at all](./atlases/inngest.md)
- [The Make atlas reads every scenario, and nothing it holds can change or run one](./atlases/make.md)
- [The KnowBe4 atlas reads who owes training, and a token the owner mints is the only key it holds](./atlases/knowbe4.md)
