# The Jam atlas maps a product whose PUBLISHED API returns none of its own nouns

Part of [Atlases](../atlases.md).

Nothing else in this installation holds a Jam team, member, connected application or recording, so by
[atlas-intent.md](../atlas-intent/06-holdings.md) §6's own test this atlas holds **everything reachable, entities
included** — with one scoping that is a DISCLOSURE bound rather than a volume one, and four findings that
each needed a different half of the atlas to produce.

## A jam's payload is withheld before any ingest, which is why there is no `jam` kind

A jam is a screen recording of a real working session, so its frames, console log, network log and DOM
snapshot are customer-adjacent material. This atlas holds a recording's EXISTENCE and metadata and never its
payload. That is a disclosure bound rather than a volume one like Datadog's: a scoping settled BEFORE any
ingest on what may be disclosed, not one settled after on what costs too much to keep — and §6's voluminous
bound does not cover it, which is why it is stated rather than inherited.

The consequence a reader needs is structural rather than a promise: **there is no `jam` KIND at all.** A
kind would be a row per recording, and the row this atlas is commissioned to hold is the page that lists
them. `webRoutes.ts` refuses `/v/<jamId>`, `/c/<id>` and `/to/<id>` outright, computed from the path rather
than listed, and `jam-payload-withheld-on-disclosure` is permanently open on the `page` kind so the bound is
somewhere a reader meets it.

## The published API declares fourteen operations and not one returns a product noun

MEASURED, and it is the finding the whole atlas is shaped around. The document Jam titles **"Jam
Public API"** at `https://api.jam.dev/openapi.json` declares 14 operations across 11 paths: an OAuth 2.1
authorisation server, `GET /whoami`, and a health check. **No operation returns a jam, a team, a member or
an integration.** Reproduce the census:

```bash
yarn tsx tools/generateJamSurfaces.ts --verify   # the committed table, no network needed
slopweaver atlas jam read --kind operation      # the 14 rows, with their parameters and response fields
```

An atlas that stopped at the published description would therefore answer "Jam offers no way to list a
recording", which is false — so the gap is permanently open rather than a footnote, and the row that answers
the question is on a surface the description does not mention at all.

## Its two hosts distinguish their own 404s, so route EXISTENCE is measurable with no credential

The sharpest thing here needs no account. `api.jam.dev` and `mcp.jam.dev` sit behind one edge and answer two
different 404s, and which one comes back says which layer produced it: `GET /mcp` answers
`application/json` with the application router's own not-found body naming the method, and `GET /health`
beside it answers a flat `text/plain` `404 Not Found` from the edge, before the application ever sees the
request. `src/atlas/jam/routeProbe.ts` carries both reproduction commands.

So a SERVED PREFIX is establishable without a credential, which is the WorkOS method arriving at a different
vendor. MEASURED across 23 probed pairs: 10 answered, 4 reached the application router with no handler, 9
were never routed at all. Three things about that are the rule rather than a note. **The denominator is
local** — Jam publishes no index of its own API surface, so the set of routes ASKED about is a table in this
repository and `route-denominator-is-local` is permanently open. **A verdict is about the PAIR, never the
path**, which is why every row carries its own method and the surface is graded `discovery`. And **the
oracle checks itself**: both hosts are also asked for a control path that cannot exist, and `sync` REFUSES
to publish a table whose control rows have stopped grading `not-routed`, because a Jam that started
answering the application's not-found to everything would otherwise fill this atlas with routes that do not
exist and nothing would notice.

## The surface an MCP client actually talks to appears in no document Jam publishes as an API

`https://mcp.jam.dev/mcp` answers an unauthenticated request with `{"error":"invalid_token"}` and publishes
its own protected-resource metadata naming itself a resource — while the published description declares
exactly one server, `https://api.jam.dev`, and no operation against that host at all. That is
[atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2 arriving as a measured property of a platform rather than as a
principle, and it is the second reason an API-only atlas here would be defeated.

**Jam also disagrees with itself, and the atlas raises that rather than picking a side.** It publishes two
protected-resource documents: `api.jam.dev`'s names the resource `https://api.jam.dev` and claims all four
declared scopes, while `mcp.jam.dev`'s names `https://mcp.jam.dev/mcp` and claims only the two `mcp:` ones.
Both records are kept and neither is preferred — §4 applied to a disagreement INSIDE one surface. And **all
four scopes the authorisation server declares are named by NO published operation**, so the consent screen a
user is shown is strictly wider than anything the published API can spend.

## The application lives under `/s/`, shares an origin with the marketing site, and answers 200 to a route it does not have

The browser half produced two defects in its own first run, and both are worth stating because each is a
class rather than a slip.

**Admission is by PREFIX here, and by exclusion on its sibling atlases.** `jam.dev` serves the marketing
site, the blog, the documentation and the published integration pages from the same origin as the
application. The first walk admitted everything-but-a-refusal, which is correct only against an admin app
with an origin to itself, and followed the blog's own footer into 90 posts and author
pages before its page cap stopped it. Every administrative page hangs off `/s/`, so that is what is
admitted.

**And an unrouted application path answers HTTP 200.** Jam renders its own not-found — "No Jam here :(" —
with no redirect and the same `Jam` document title every real page carries. Nine of the twelve routes the
first walk seeded were that page, and every one was published as `landed` with a verified screenshot. That
is the Notion walk's failure reached by a different road: there the shots were byte-identical and
`kit/indistinguishableShots.ts` would have caught them, and here the page ANIMATES, so nine renders spanned
94,237 to 95,526 bytes and no two were equal.

`notFoundControl.ts` is the fix and its shape is the transferable part. The walk declares TWO controls — the
application's own `/404`, and an invented route at the bare origin that cannot exist — each graded by
exactly the code every other page is graded by, and a page is called not-found when its screenshot falls
within 5% of the same run's controls.

**Two controls rather than one, because one cannot fail.** A control compared against ITSELF necessarily
succeeds: it establishes that `/404` was photographed, never that `/404` rendered a not-found. The
counterexample is concrete — Jam starts serving a real page at `/404`, an ordinary declared route starts
rendering the actual not-found at a different size, and the walk publishes that route as reached on the
strength of a boolean that could not be false, the class this repository keeps paying for. The band is
anchored on the INVENTED route, which cannot become a real page, and the declared `/404` must fall
inside it; if the two ever diverge no page grading is published at all, and the refusal names both sizes and
the drift.

**Measuring the control per run rather than baking it in is the load-bearing half, and two walks show why.**
Within one walk the not-found page is tight — control 94,926 bytes, the nine not-found pages inside 1% of
it. Across walks the same page moves: the third walk's control came back at 99,943, 5.3% higher, because the
strawberries fall in different places. A threshold measured once would have been wrong by more than its own
width. **The honest margin is also smaller than one run suggested**: the nearest real page reads 13.1% away
from walk 1's control, 7.4% from walk 3's, and 6.4% from a later walk's, so the band at 5% clears
the within-run spread (1.2% at most) about four times over and leaves roughly 1.3× to the nearest real page.
`settings/account` is that page, and it is the one to watch.

**The invented control lives at the bare origin, because Jam forwards an unknown TEAM route to `/404`.**
MEASURED: `jam.dev/s/<team>/zzz-not-a-real-route` client-redirects to `jam.dev/404`, the declared
control's own address, so a control addressed there is graded unreached and every resync refused.
`jam.dev/zzz-not-a-real-route` still renders the not-found in place, so the anchor is addressed there, and
`jamPageOutcome` names a forward to `/404` as Jam not serving the route rather than as a sibling page.

**A run whose control does NOT fire is refused rather than published**, and the refusal NAMES which of the
three checks failed — the control absent, unreached, or reached and unphotographed — because a walk whose
detector has gone inert cannot tell a real page from a rendered 404, and that is the state this atlas
already shipped once. It fired for real during development: a walk whose control lost its screenshot was
refused, and nothing was written.

**What the walk then found is the honest browser half.** Nine of sixteen declared pages rendered and every
one was photographed. Six more are real routes the application CANONICALISES elsewhere —
`settings/connected-apps`, `…/integrations/helpdesk`, `…/integrations/issue-trackers`,
`…/integrations/webhooks` and `settings/recording-links` all settle on a different settings tab — and each
is recorded as redirected with no picture at all, because the kit writes no screenshot for a page that went
somewhere else. That is a stronger property than withdrawing the claim afterwards: the bytes never reach
disk.

**And nothing can widen the denominator by crawling.** Eleven of the pages that rendered carried zero
same-origin links, because the settings navigation is built from controls rather than anchors; the dashboard
is the one page with a real link list and every one of its eighteen links is a marketing address the
prefix admission refuses. `web-denominator-is-harvested` is permanently open saying so.

**The integration kind's browser channel is EMPTY on purpose, and that was the third over-claim.** Deriving
an integration slug from the next segment of a landed `/s/settings/integrations/…` route — which a sibling
atlas legitimately does — found `ai-agents`, `helpdesk`, `issue-trackers` and `webhooks`, Jam's integration
CATEGORIES, and the report duly announced four integrations the application names that Jam publishes no page
for. All four were invented by the comparison. That is §4's own question asked of this atlas: is the thing
being matched the provider's own key, or an artefact of how one surface phrased its question? The channel now
writes a `deferred` cell naming the limit, which is a different claim from "this workspace has installed
none" and the only one the seam supports.

**The `web-client-operations` surface is filled and holds nothing, which is itself the measurement.** Across
one walk the transport saw 49-114 responses per page and graded ZERO of them eligible, because none carried
a JSON content type — so this atlas observes no first-party operation at all and the coverage cell says that
rather than leaving a silence. It is the Nx Cloud finding one vendor over, and the same caution applies: a
count of observed calls is never a completeness claim on a `discovery` surface.
