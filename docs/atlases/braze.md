# The Braze atlas is the first here whose two FILLED surfaces are both published documents

Part of [Atlases](../atlases.md).

Every other atlas that can disagree with itself had to drive a browser first. Braze can on the day it
lands, because it publishes its REST API twice and the two copies do not match.

**Braze publishes no OpenAPI document.** What it publishes instead is an endpoint reference that
server-renders a machine-readable block into every page —
`<div class="api_type"><div class="method get">get</div><p>/campaigns/data_series</p></div>` — and an
official Postman collection linked from that same reference. `src/atlas/braze/docsCatalogue.ts` reads the
first and `collection.ts` the second; the sitemap is the enumeration and each page's own `lastmod` is the
cache key, so a page Braze has not touched is never re-fetched.

**MEASURED, reproduce with `slopweaver atlas braze sync --json` then `… report --json`:**

|                                                                  |                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| Documented operations, across 15 families                        | **146**                                            |
| Collection requests, and distinct operations after normalisation | **101 → 97**                                       |
| Operations both sources describe                                 | **93**                                             |
| Documented, absent from Braze's own collection                   | **53**                                             |
| Shipped by the collection, never documented                      | **4**                                              |
| Distinct operations across both                                  | **150** — 50 reachable, 19 voluminous, 81 excluded |

**The shape of the drift is the finding, not its size.** Five families are absent from the collection
ENTIRELY — `data_objects` (20 operations), `translations` (16), `sdk_authentication` (4), `cdi` (3) and
`apps` (1) — which is a collection frozen before those product areas shipped rather than a sloppy one. The
four operations only the collection has are three News Feed endpoints for a product Braze has deprecated,
plus `POST /messages/live_activity/update`; their reference pages return Braze's soft-404 shell.

**Two published addresses do not resolve as written, and the atlas records rather than repairs them.**
Braze's own reference renders `scim/v2/Users?filter=userName eq "user@test.com"` — a usage example, complete
with typographic quotation marks — into the block whose job is to declare the address alone; and the
collection ships `https://{{instance_url}} /v2/subscription/status/set` with a literal space, beside a
correctly spelled copy of the same operation.

**The disposition criterion cuts through this platform in a direction the HTTP method gets wrong.** Braze
answers several of its largest READS with `POST`, because their selectors do not fit a query string. So
`POST /users/export/ids` is reachable and `POST /users/track` is excluded, and a rule keyed on the verb
would silently drop the export half of the surface — the half a question about a real user is answered
from. `src/atlas/braze/dispositions.ts` matches those by name, before the mutation rule sees them.

**The census is RECORDED and the READER is enforced**, which is the opposite of the Microsoft 365 atlas and
for a stated reason: that one pins an immutable commit, so a digest settles everything. Braze's sources are
live — 289 of its 1,352 pages changed in the month before this landed — so a census gate would refuse to
publish within days. What `sync` refuses on instead is its own ability to read: every declared operation
page must yield the block, and the optional extractions must still find something.
`src/atlas/braze/specLock.ts` carries both halves.

**Neither live surface is filled, and the atlas is specific about why.** There is no Braze API key and no
Braze account: measured, `dashboard.braze.com` redirects to `/sign_in` with no session, the 20
`.braze.com` cookies on this machine are all marketing-site instrumentation, the owner's mailbox has never
received a message from `braze.com`, and `HELP-990` — Braze SSO via JumpCloud — is still `Todo`. Eight
dashboard routes are DECLARED so the emptiness is measurable, and every one is grounded in a page this
installation actually reached or an address Braze itself printed. Exactly ONE literal dashboard address
appears in the whole reference, so the declared list is a stated FLOOR carried as the
`browser-route-inventory-undiscovered` gap rather than a list of invented URLs. There is deliberately no
`walk` verb: a verb whose only possible output is a photograph of a sign-in page would be a promise rather
than a capability.

**Which Braze cluster this organisation uses is INFERRED and labelled so everywhere.** Every Cloudflare DNS
record tagged `braze` on the organisation's domain is `ap-southeast-2` Amazon SES, including a click-tracking
CNAME to `r.ap-southeast-2.awstrack.me`, which points at AU-01. Only an account can settle it.
