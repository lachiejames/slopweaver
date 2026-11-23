# The Inngest atlas gets its route table from the vendor, and its GraphQL surface from nobody at all

Part of [Atlases](../atlases.md).

Nothing else in this installation holds an Inngest app, function, environment, event key, signing key, event
type, webhook or integration, so by [atlas-intent.md](../atlas-intent/06-holdings.md) §6's own test this atlas holds
**everything reachable, entities included** — eight entity kinds beside its three surface-map ones
(`operation`, `page`, `graphql-operation`). A function RUN and an EVENT are the voluminous complement and are
therefore not kinds at all: the operations that list them are held and classed `voluminous` with the rule
that decided it, because they are observations the platform emits and identifies by an instant, while an app,
a function's definition and an event TYPE's schema are configuration somebody's codebase declared. Five
things about it are worth stating.

**No machine-readable description of the REST API exists, and the vendor's own markdown mirror is broken.**
MEASURED: `api.inngest.com/openapi.json`, `/v1/openapi.json`, `/v1/doc` and
`api-docs.inngest.com/openapi.json` all answer 404, and the only machine-readable document the API reference
still serves is `api-docs.inngest.com/llms.txt` — **65 operations across 16 groups, 15 on `v1` and 50 on
`v2`**, each with its own group, title and description. What it does not carry is any operation's HTTP method
or path template, and that half is unreachable rather than unlisted — `api-docs.inngest.com/llms.txt` answers
200 while `api-docs.inngest.com/llms-full.txt` and `api-docs.inngest.com/v1/events/ListEvents.md` both answer
**HTTP 500**. Re-check all three with `slopweaver atlas inngest sync`, which probes them on every run.

The `.md` address is the one the reference site's OWN client bundle asks for, and `robots.txt` on the
marketing site advertises the markdown mirror to AI crawlers by name. So the operation shapes are rendered
into a page and served to nobody who is not a browser. The atlas records what it has and opens a
`vendor-document-errors` gap carrying those addresses, because `POST /v2/apps/{appID}/sync` inferred from the
words "Sync app" would read exactly like evidence and be nothing of the kind. The sync re-checks both
addresses on every run, so the gap closes itself the day Inngest fixes them.

**The two REST versions answer an unauthenticated probe in opposite ways, and that is the whole reason
`unprobeable-control-agrees` exists.** `/v1` routes its request before it authenticates and `/v2`
authenticates before it routes:

```text
GET /v1/events                                   401     GET /v2/apps                        401
GET /v1/zzzsyntheticzzz-control                  404     GET /v2/zzzsyntheticzzz-control     401
GET /v1/events/zzzsynthetic/zzzsyntheticzzz-…    404
```

So on v1 a probe establishes existence and on v2 it establishes nothing at all — recording a v2 row as
either "exists" or "not found" would be a lie in one direction or the other. **13 of the 15 v1 operations are
confirmed to exist**, one more (`ResumeSignal`) by a `405 Method Not Allowed` that proves the route is there
without a write ever being sent, and one has no address a GET reaches. All **50 v2 operations** are
`unprobeable-control-agrees`, with the control's own note stored on each row. `/v1/apps` and `/v1/functions`
answer 404, which is both the proof that v1's discrimination is about the ROUTE rather than the path depth
and the honest answer to "can I list apps on v1" — no; that surface is v2-only. The reviewed address table in
`restAddresses.ts` is a READING of the catalogue rather than a vendor declaration and says so on every row it
produces; a wrong entry is not a quiet wrong answer, because on v1 it answers 404 like every control and the
sync raises `rest-route-absent` naming it.

**The dashboard's whole navigation surface comes from the application's own route table, which it ships to a
signed-out visitor.** `app.inngest.com` is a TanStack Router application whose entry bundle declares every
route as `X.update({ id, path, getParentRoute: () => PARENT })`, so composing a full address is walking the
parent chain — **81 routes, 46 of them carrying an identifier segment**. This atlas therefore files no
"denominator is a hand list" gap, which every sibling walk here has to: the denominator is the vendor's own
statement of its navigation surface, and a route Inngest adds appears on the next sync without anybody
noticing it. The bundle's filename is content-hashed, so it is read off the sign-in page's `modulepreload`
links rather than pinned, and the default environment slug is read from the Clerk bootstrap that page inlines
rather than guessed.

**The dashboard's discrimination is per DEPTH, so the control is taken per prefix.** At the root an invented
address answers 404; below a layout segment the application serves the identical sign-in redirect to any
address at all. MEASURED on the same run: `/integrations/…`, `/mcp/…` and `/support/…` discriminate, while
`/settings/…`, `/env/…`, `/billing/…` and `/intent/…` do not. One control for the whole origin would have
credited every settings route with an existence the application never established, so a control is probed for
every parent prefix a run is about to visit and only prefixes answering 404 yield existence evidence. Two
routes the table declares answer **HTTP 500** to a signed-out visitor — `/organization-setup` and
`/user-setup` — and one more answers 500 to a signed-in one; each is a `dashboard-route-errors` row rather
than a silence.

**Its GraphQL surface has no published denominator, and that is the sharpest instance of
[atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2 here.** `api.inngest.com/gql` is a first-class Inngest API — the
dashboard's entry bundle names it directly — and it publishes no schema and answers `introspection disabled`
to a `__schema` query. An API-only atlas would report that Inngest offers no GraphQL API at all. The first
signed-in walk observed **41 operations carrying 11 distinct schema root fields**, every one of them known
only because the client was watched sending it, and the census is recorded as a FLOOR rather than a fraction
with a permanently open `graphql-introspection-disabled` gap carrying the one line that settles it. The
identity is read from the REQUEST document rather than the response, for the reason `kit/graphqlDocument.ts`
carries — a response's own keys are the document's aliases, and a comparator built on them manufactures
disagreements. That module moved into the kit for this atlas rather than being cloned into it.

That first walk reached **31 of the 39 admissible routes and photographed all 31**. Fifteen of the 81
declared routes are refused as inadmissible by name and reason in `browserPages.ts` — a visit that signs the
session out, starts an OAuth handshake or creates a webhook is not a read, and the transport's own snippet
only ever navigates and screenshots. **No credential can reach a screenshot, and TWO independent things make that true**: `browserPages.ts`
refuses to photograph the three pages that render one, by name and reason, and the refusal is checked
before the bytes exist rather than after; and Inngest masks every credential in its own dashboard behind
a reveal control the walk never clicks, so a picture would have shown `signkey-prod-XXXX…` or
`sk-inn-api••••<last four>` anyway. The second is the platform's property and can change without warning,
which is why it is not the only one.

Two smaller things. The dispositions come out **22 reachable, 26 excluded, 17 voluminous**, and the rule that
decides them cuts through a product area rather than along it: `ListRuns` returns observations and
`ListInsightsEventSchemas` returns the shape of an event type somebody's codebase declared, so they are
graded oppositely inside one Insights/Runs neighbourhood. And an operation id is NOT unique across the two
versions — `CancelRun`, `CreateWebhook` and `ListWebhooks` each exist in both against different addresses —
which is why every row is keyed `<version> <operationId>`; a map keyed on the id alone had v2's pass
silently overwrite v1's probe evidence for all three while this atlas was being built.
