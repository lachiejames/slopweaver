# The Linear atlas is a SURFACE MAP, not a second copy of the corpus

Part of [Atlases](../atlases.md).

Owner's ruling: a platform whose entities the world model already holds gets its SURFACE mapped
rather than its contents copied. Linear is that platform, so this atlas holds four kinds — every GraphQL
root field (`operation`), every named schema type (`type`), every reachable settings page with its held
screenshot (`page`), and the workspace and team CONFIGURATION the owner named: workflow states,
integrations, labels, templates, statuses (`setting`). Issues, projects, comments and documents are the
corpus's, and `atlas/linear/rootFieldCensus.ts` classifies **every** root field the schema declares as
admitted, deliberately excluded with a reason, a mutation this atlas never calls, or a subscription it never
opens — so a root field Linear adds next month raises an `unclassified-root-field` gap instead of quietly
not existing.

**Introspection is batched because Linear refuses it whole.** Measured: one whole-schema query
answers `Query too complex. Complexity: 65536. Maximum allowed complexity: 10000.` The cost is per type and
close to linear — 33 points for one, 3,270 for a hundred — so the walk asks for a hundred at a time and the
whole schema costs 13 requests and 38,430 points against budgets of 2,500 requests and 3,000,000 points an
hour. Every batch must return one non-null `__type` per alias it asked for, and the cheap type census is
read again afterwards and compared: a schema that moved mid-walk REFUSES the publish rather than producing a
generation that is half one schema and half another.

**The browser channel reads the client's own DOCUMENT, never the response's keys.** A GraphQL response key
is the document's alias, so `query { latest: issues { … } }` answers under `data.latest` — a name the schema
does not declare. Comparing response keys to schema names would manufacture disagreements in the one atlas
whose purpose is finding real ones, so `browser/pageTransport.ts` captures the request body and
`atlas/linear/graphqlDocument.ts` parses it. A request with no readable document — a persisted query sending
only a hash — is counted and NOT attributed, as a `request-shape-unresolved` gap.

**What the first real walk found**, 82 of 251 declared settings pages reached in the owner's own
Chrome: five root fields the first-party web client selects that Linear's published schema does not declare
at all. Read the current list with `slopweaver atlas linear report`. Three cautions belong with that number.

The first is about the number itself. An earlier run of the same walk reported SEVEN disagreements, and the
extra two were the comparison rather than the platform — a browser path carries array markers the schema
never uses, and the browser walks three levels where the schema catalogue resolves one. Both are
normalised away, and the episode is why `docs/atlas-intent/04-corroboration.md` asks every two-surface atlas whether both
sides are describing the same thing at the same depth. The walk's denominator is
a route table declared in `atlas/linear/routes.ts` rather than a sitemap Linear publishes, so a route
MISSING from that table cannot be detected from inside the walk — a permanently open
`page-inventory-is-declared` gap says so. And the run stopped partway when the browser relay dropped, which
is recorded as `settings-walk-incomplete` naming all 162 routes it never attempted; a partial walk is
explicitly forbidden from staling pages an earlier one found.

**Its permanent claim boundary is one member's session.** Measured on this installation, `viewer.admin` is
`false`, so `webhooks` answers _"You must be a workspace admin"_ and `oauthApplications` answers _"Invalid
scope: `oauth:create` required"_. Each is an `unavailable` coverage cell carrying the provider's own
sentence, not a silence — and the run continues, because an API surface that read perfectly is still worth
publishing.

**What it deliberately does not hold:** a webhook signing secret, a calendar URL with a token in it, and a
workspace's SAML, SCIM, auth, security or AI-provider configuration blobs. `settingSurfaces.ts` never selects them
and `sensitivity.ts` re-checks the class at publish time, REFUSING a generation rather than redacting one —
a redacting gate leaves a generation silently different from what was read. The fields' existence stays
visible through the `type` kind, which is the point: the atlas says `Webhook.secret` exists and never says
what it is.
