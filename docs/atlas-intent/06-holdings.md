# 6 · What an atlas HOLDS is per-platform, and the criterion is who else holds it

Part of [What an atlas must be](../atlas-intent.md).

The owner's ruling, answering the scope question the Slack atlas was blocked on. It is not a flat
preference for one shape — it is a test an atlas applies to its own platform, and it can come out either way.
The Slack atlas holds the surface map for Slack, because **something else better suited is holding all the
entities.**

**The test, in one sentence: does something better suited already hold this platform's entities?**

- **Yes → the atlas holds the SURFACE MAP only.** Every page, endpoint, method, parameter and response
  field; where each thing lives and the exact URL that proves it. It does not re-hold the entities, because
  a second copy is a second thing to keep in sync and the first copy is already better at the job.
  **Slack is this case** — the corpus holds its channels, people, usergroups and messages, so the atlas maps
  the interface rather than the workspace.
- **No → the atlas holds EVERYTHING REACHABLE, entities included**, because otherwise nothing does.
  **Vanta, JumpCloud, 1Password, Cloudflare, Trelica and GraphQL Hive are this case** — Trelica most
  sharply, since it is the organisation's own SaaS-discovery product and its application inventory exists in
  no other store here, and Hive for the same reason one level down: nothing anywhere holds a schema
  registry, so its organisations, projects, targets and composed schemas are the atlas's rather than a
  second copy of somebody else's.

**The one bound, and it is the answer to "where do you stop":** an atlas gets essentially everything, the only
real exception being data that is **highly voluminous, such as audit logs**.

A highly voluminous surface is enumerated and declared rather than stored whole. Its existence is atlas
content; its every row is not.

**It is a DISPOSITION, not an exclusion, and the difference is load-bearing.** An atlas that excluded its
voluminous families would answer "this platform has no log search", which is false, and would contradict
the owner's own steer against doing nothing. The family is still reached — called over a bounded window, its shape
recorded — and simply never publishes a row per record. An excluded surface is one nobody looked at; a
voluminous one has been looked at and deliberately not stored whole. An atlas must be able to say which.

**Every atlas DECLARES this per family, and the store refuses a generation that contradicts the
declaration** — the owner's ruling: an atlas includes everything reachable EXCEPT highly voluminous data,
which is stored as catalogued **SHAPES** (like the Datadog plan), not rows; the JumpCloud per-device
telemetry, a large observation family, should never have entered the atlas as rows; and **the rule
applies to every atlas.**

The file the owner named was real: MEASURED, `~/.slopweaver/atlas/jumpcloud/systeminsights.jsonl` held
**hundreds of thousands of published entity rows**, one per per-device osquery observation across many
`v2-systeminsights-list-*` operations, every row carrying its own `collection_time` — while its coverage
cell read `state: "synced"`. The same atlas's descriptor correctly declared `events` and `commandresults`
shape-indexed, in free prose that no code read. A rule stated in prose beside prose cannot tell a family
somebody judged from one nobody looked at, which is why the answer is a type rather than a sentence:

- **`AtlasStoreSpec.kindVolumes` (`src/atlas/kit/volume.ts`) is REQUIRED on every atlas**, the same way
  `kindObligations` is and for the owner's same reason — it applies to all atlases. An atlas
  with nothing voluminous declares `{ verdicts: [] }`.
- **A verdict is one of three**, and the third exists so an atlas need not lie. `shape-index` — unbounded
  observations, catalogued and publishing zero rows, carrying an `AtlasVolumeBasis`. `bounded-observation` —
  observations the PROVIDER keeps finite (a retention window, a `status:'open'` filter), carrying the bound
  and the measurement taken against it. `bulk-entity` — configuration somebody created, large but
  enumerable, carrying the row count it was judged at.
- **`publishAtlas` refuses** a generation writing rows for a shape-indexed family, and refuses a kind over
  `UNDECLARED_ROW_CEILING` that carries no verdict at all. The ceiling is a tripwire, not the rule: it
  catches the family nobody classified, and passing it proves nothing.
- **A verdict may name an OPERATION**, because the criterion below cuts THROUGH a family. JumpCloud's
  `assets` holds the device assets beside `v2-list-device-asset-history`; its `policies` holds the policies
  an administrator authored beside a much larger `v2-policyresults-list` observation family.

**`bounded-observation` is not a loophole, and the §9 ruling is why it had to exist.** Cloudflare's
`access-authentication-log`, `dex-test` and `dex-fleet-status` are time series, and the owner REJECTED that as a
ground for holding them out once they were measured; `cloudflare/inventory.ts`
carries the table — `dex-fleet-status` stays bounded by the provider's WHOLE retention window, far below
the qualifying-volume class the owner's own example (a terabyte) names. So the criterion below identifies
which families are CANDIDATES and volume is still the bound. Re-declaring a measured, provider-bounded family
`shape-index` on the criterion alone re-litigates a ruling that has a measurement against it.

**What makes a family voluminous, as a criterion rather than a list of examples:**

> Its records are **time-series OBSERVATIONS** — emitted by the platform rather than created by a person,
> unbounded, growing with the clock, and identified by an INSTANT rather than by a name somebody chose.
> **Configuration is the complement**: what a person or a system CREATED, and what can be listed
> exhaustively.

Established by the Datadog atlas row. Naming audit logs and event streams reads as a list of
families to skip; the criterion above **cuts THROUGH a family rather than along it**, which is why it has to
be applied per operation. `GET /api/v2/logs/events` returns observations and is shape-indexed;
`GET /api/v1/logs/config/indexes` returns configuration somebody authored and is an entity — same kind, same
product area, opposite dispositions. A rule stated as a list of families cannot express that, and an atlas
built from one would drop the second along with the first.

**What the Slack surface map means concretely**, since "surface map" was the half that kept getting
re-derived. The owner worked it out on the call by opening Slack and naming pages, so the list is the
owner's:

- **Every page's EXISTENCE is recorded** — that is the floor, and it applies even where a screenshot does
  not: at the least, the atlas knows every page that exists.
- **Settings pages get a screenshot**: account settings (which absolutely belong), the notifications
  tab, the profile tab. Integrations is in the atlas as a page, but not a screenshot of every installed
  app — the page, not a shot per app.
- **No screenshot per message and none per channel.** Nobody expects a browser piloted to photograph every
  message ever sent.
- **Today, Home and Files: existence yes, contents no.** Most of that belongs in the corpus rather than the
  atlas. A single screenshot of Today is permitted rather than required, and is not worth much.
- **The owner's access is non-admin, and that is the current bound**, not a permanent one — without full
  admin access to Slack there is a lot the owner cannot see yet, and admin read access would open many more
  settings pages. Those pages are declared GAPS rather than silently
  absent, so the atlas stays honest about what its credential could not reach (§"Honest about its own gaps").

**The corollary a consumer needs, and the reason this claim is worth stating at all:** an atlas holding the
surface map is not a lesser atlas, and it is also not a source of entities. A reader that needs to know
whether a thing EXISTS on such a platform reads the corpus; a reader that needs to know WHERE to go and
what can be asked reads the atlas. Reading the surface map as an entity index is how a platform ends up
looking empty when it is fully covered.
