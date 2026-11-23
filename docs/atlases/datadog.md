# The Datadog atlas is bounded by a DISPOSITION table, not by an allowlist alone

Part of [Atlases](../atlases.md).

It was the largest surface here when it landed — **1,735 operations**, generated from the pinned
`@datadog/datadog-api-client` and committed as `atlas/datadog/generated/surfaces.ts` — so what makes it safe
is not that some rows are refused, but that **every** row carries exactly one of four dispositions and the
generator refuses to emit a row it cannot decide.

| Disposition   | Rows | What it means                                                                                                 |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `entity`      | 654  | called, projected and stored, across 115 kinds                                                                |
| `shape-index` | 90   | called over a bounded window; only the SHAPE is stored — which attribute paths exist, never an entry or value |
| `probe-only`  | 3    | called to establish credential posture and never stored at all                                                |
| `excluded`    | 988  | inventoried and never called                                                                                  |

**`shape-index` is the owner's scope rule as a treatment rather than a refusal.** "Everything reachable minus
the voluminous" would have been mis-modelled as an exclusion: an atlas that refused log search answers
"Datadog has no log search", which is false and contradicts the owner's own ruling on voluminous telemetry — a
steer against doing nothing. The rule that decides membership is stated once in `shapeIndexed.ts`: **a family is
voluminous when its records are time-series OBSERVATIONS** — emitted by the platform, unbounded, growing with
the clock, identified by an instant rather than by a name somebody chose. It cuts THROUGH families rather
than along them, which is why it is an operation table and not a kind list: `GET /api/v2/logs/events` is
shape-indexed while `GET /api/v1/logs/config/indexes` is an entity, under the same kind.

**The HTTP verb decides nothing, and there is a row that proves it.**
`GET /api/v1/graph/snapshot` renders a widget in a web page, captures it and uploads the image to cloud
storage, and `GET /api/v2/cost/tag_descriptions/{tag_key}/generate` invokes Datadog's own AI to write a
draft description. Both are GETs that produce something, and both are refused for what they DO. The
converse holds too: 37 POSTs are on a reviewed observational allowlist, because Datadog uses POST for
search as well as creation. **Both refusals were found by adversarial review passes rather than by reading
the table**, which is why `exclusions.test.ts` asserts that no admitted operation's own name begins
with a creating or mutating verb — the SDK names every operation, so that is a free second opinion on a
list reviewed once and grown afterwards.

**Two operations are refused as `secret-bearing`, and the reason generalises.**
`GET /api/v1/api_key/{key}` and `GET /api/v1/application_key/{key}` take the credential AS THE PATH
PARAMETER, so no projection of a RESPONSE can undo a secret in a REQUEST. The key LIST reads stay reachable,
because refusing them would answer "Datadog has no way to enumerate keys" — field denial is what protects
those.

**A field is denied for its SHAPE as well as for its name.** Five rows name nothing that sounds like a
credential: `customHeaders`, `headers`, `payload` and a synthetics global variable's `value` are free-form
strings and maps a PERSON fills in, and `{"Authorization":"Basic …"}` is the ordinary thing to put in one.
Adversarial passes found FOUR of these reaching a kind file, and all four were `synthetics`:
`SyntheticsBasicAuthSigv4.secretKey`, then `SyntheticsTestRequest.body`, then `.form`, then
`SyntheticsBrowserTestConfig.setCookie`. Each fix enumerated one more model and the next round found a
field on a model that enumeration had not reached — one mistake repeated, and a fact about the subject: a
synthetic test IS a request somebody configured, including its authentication, its cookies, its variables
and the responses it captured. **202 fields across the 379 `Synthetics*` models are declared free-form, and
168 of them are denied by nothing** — a denylist over that is a list somebody grows past, so the shape that
would close the kind is an ALLOWLIST projection rather than a fifth patch to the table.

**That kind is excluded whole until that projection exists, and the reason is a different KIND of
reason.** `exclusions.ts`'s `DATADOG_EXCLUDED_KINDS` refuses all 69 synthetics operations — 34 under the
`unsupported-sensitive-shape` reason, the other 35 keeping the `mutating` reason they already had — which
takes 23 entity and 11 shape-index operations out of the live pass. The other three reasons are facts about
the operation, true forever; this one is a fact about what this atlas can safely store, true on every
installation alike until the projection ships. Keying on the KIND rather than on 34 paths is the point — an
operation Datadog adds next month is excluded by the same decision, which a hand-listed set of paths would
not do. It is not a volume judgement and not a way to shrink a hard kind: the bar is a full atlas, and a
family in heavy use is `shape-index`ed and still called. The allowlist paragraph above is the specification
for what must be built BEFORE a live pass may store a test.

`atlas datadog sync` publishes the compiled catalogue, from a committed registry, with no credential
presented at all. `atlas datadog sync --live` is the half that reaches this organisation — and synthetics is
not in it, so no synthetics response has ever reached a kind file. The rule that generalises: a field whose
declared type is a free-form string or map a person authors is denied wherever a credential could be typed
into it, whatever its name suggests — and each such denial states its cost, because "the atlas cannot say
which headers a synthetic test sets" is real and hiding it would be the same dishonesty the atlas exists
against.

**Two more denials were found by the GATE, on the first live passes, which is the mechanism working rather
than failing.** Both are recorded in `freeFormFieldDenials.ts`, the shape-denial run of the table
`sensitiveFields.ts` composes, with the pointer the refusal named. The first is
`samples` under `logs` — the log lines somebody pasted into a Grok parser so its rules could be written
against something real, and a real log line can carry credential material; it is `customHeaders`'s class
exactly, a free-form string a person authored. The second is a class rather than a row: **two Datadog products exist to
recognise credentials, and each publishes a rule library that describes what one looks like.** Sensitive Data
Scanner's ~450 `standard-patterns` and Static Analysis's secret rules carry Slack tokens, JWTs, GitHub tokens
and PEM blocks in their `description` and `pattern` fields, because a rule that detects a Slack token
describes itself with one. Those are real matches, not false ones, so the two fields are not STORED rather
than taught to the gate as an exception it would carry for every kind. The cost is stated: the atlas can say
which detection rules exist, not what each one looks for.

**Field denial here is scoped to a KIND, and it has to be.** MEASURED against the SDK's own models: the field
name `key` appears on **49** models and carries credential material on **nine**; the other forty are a
case's identifier, a feature-flag key, a flag variant, a cost-allocation tag, a dashboard widget group-by, a
fleet agent tag, a Model Lab metric name. `token` is a public-dashboard share credential that grants
ANONYMOUS read under `dashboard` and a pagination cursor under `security`. A bare-name denylist is wrong in
both directions, so every row of the table `atlas/datadog/sensitiveFields.ts` composes names the field AND
the kinds in which that name carries material. Reproduce with `yarn tsx tools/generateDatadogSurfaces.ts --verify`.

**The gate is wired into publishing, not into a convention.** `atlas/datadog/store.ts` is a spec FACTORY
whose `guardPublish` closes over the kind files about to be written and scans each under its own kind, plus
the manifest under a kind of its own. A hit refuses the WHOLE generation before the kit opens a file. It
deliberately does NOT pattern-match a bare hex run: a Datadog API key is 32 lowercase hex and an application
key is 40 — and so is a git commit SHA, which this atlas legitimately stores on every CI, DORA and
static-analysis record. A hex rule would refuse most real generations. What replaces it is exact: the gate
takes the credential values this process holds and refuses a document containing any of them verbatim.

**One surface is filled, and the other two say exactly what they are short of.**
`compiled-catalogue` flips the moment `atlas datadog sync` runs — it needs no credential, so it is filled on
any install that has run the verb once, and `surfaceFill.ts` derives that from the manifest rather than from
a literal.

**`api` is LIVE, and `declared-unfilled` on purpose.** `atlas datadog sync --live` asks this
organisation the **329** entity operations that take no path parameter, through the same closed registry —
an `excluded` row has no callable variant anywhere in the module, so a mutation is unreachable rather than
merely unused. MEASURED on the first full pass against this install's site, before any response boundary
existed: **201 of 329 answered**, and the
144 stored `api` cells read **6 `synced`, 79 `deferred`, 20 `unavailable`, 19 `unreadable`, 18 `excluded`, 2
`not-configured`**. Reproduce on any install with `slopweaver atlas datadog sync --live`.

**Every answer crosses its operation's own strict boundary.** `src/atlas/datadog/apiCall.ts` admits a 2xx
body only through `responseRegistry.ts`'s generated boundary for that operation — 326 of them, declared from
the pinned specification and checked against a census of live answers (`responseCodegen.ts`'s header is the
contract). A key Datadog adds, drops or retypes refuses as `BODY_SHAPE_CHANGED` naming the field and never a
byte of the body; the three operations the specification declares as answering a file are refused unread. 123
boundaries hold only the specification's names, because the census never saw those operations answer: they
still refuse a renamed key, and coverage counts what they admit as still owed its measurement. Regenerate
after a fresh census with `yarn tsx tools/generateDatadogResponseBoundaries.ts <spec-dir> <census.json>`.

**Only SIX kinds earn `synced`, because a kind with no call to make is not synced.** Against the property
"the live pass cannot publish a generation claiming more coverage than it earned", a review pass found 18
kinds publishing `api: synced` having made no call at all — every operation each carries is `excluded` or
`probe-only`, so the three-way decision fell through to `complete` and the cell read `0 record(s) from api`
beside the word `synced`: the "reported N, reached one" failure. Those kinds are `excluded`, the kit's word for a bound of CONDUCT rather than of reach, and their cell
says nothing was ASKED rather than that this organisation holds none. FOUR remainders
keep the surface unfilled and each is enumerated per
kind as a coverage cell AND a gap: **325** entity operations take an identifier and need a fan-out from an
already-stored entity; **97** of the 329 walk a collection and this pass keeps their first page; an answer
admitted by one of the **123** names-only response boundaries had every value unread (gap
`api-response-boundary-unmeasured`); and all **90** shape-index operations need a windowed pass. `surfaceFill.ts` reads the verdict off the stored CELLS
rather than the manifest, because one per-kind timestamp cannot speak for three channels — so a live pass
moves this surface's REASON without moving its status, which is the point. An `api` surface that flipped to
`filled` because 329 of 1,069 reachable operations answered would be the sibling Slack atlas's "reported N,
reached one" in a new costume.

**The atlas holds this organisation's own monitors, dashboards and notebooks, BESIDE the operations —
and an atlas that did not would say so.** An atlas of SDK OPERATIONS alone answers `atlas datadog read
--kind monitor` with `v2-monitors-update-monitor-config-policy` and its siblings while the account runs
hundreds of monitors; two dogfood turns hit that independently and both abandoned the
atlas for `slopweaver datadog raw`. Two halves close it, and each stands without the other.

_Filling._ `src/atlas/datadog/estateAcquisition.ts` explodes the answers of three list operations the live
pass ALREADY issues — `v1-monitors-list-monitors`, `v1-dashboards-list-dashboards`,
`v1-notebooks-list-notebooks`, all three already inside `DATADOG_API_ADMITTED` — into entities of their own.
No second transport, no second budget, no request the closed registry did not already admit: what was
missing was never the call, it was that the answer sat inside one operation entity's `detail` with nothing
addressing the records in it. One extractor per row rather than a find-the-first-array heuristic, because
the three envelopes disagree (monitors are a bare array, dashboards are under `dashboards`, notebooks under
`data`) and a heuristic would have worked on all three that morning and picked a widget list the day a
response grew one. An estate record carries an `api` channel and NO `compiled-catalogue` channel, which is
what tells it apart from an operation, and a record whose id collided with a registry operation name in the
same kind is REFUSED rather than merged over that operation. MEASURED on the first pass
against a live site: **hundreds of estate records across monitors, dashboards and notebooks**, with the
`api-first-page-only` gap still naming where a page was cut. Reproduce with `slopweaver atlas datadog sync
--live` and read them with `slopweaver atlas datadog read --kind monitor`.

_Grading._ `src/atlas/kit/estateEvidence.ts` is the generic half, and it knows nothing about compiled
catalogues. `ATLAS_EVIDENCE_ROLES` had carried `authoritative` / `corroborating` / `discovery` since the kit
existed, and Datadog's descriptor had always declared `compiled-catalogue` as `discovery` — _"can reveal
that something exists without establishing anything about its contents"_ — so the atlas was already saying
this in a field it publishes, and no reader consulted the field. Now `atlas <platform> read` prints
`NOT ANSWERABLE ABOUT THE ESTATE` under a kind's counts and `atlas doctor` names those kinds on the
platform's row. **The criterion is per RECORD, and two drafts that made it per KIND both passed their own
tests while letting the founding case through**: asking whether any authoritative surface had seen anything
in the kind clears `monitor` on the first live generation, because the live pass filled the `api` channel of
all 29 OPERATION entities. So a record counts only when an authoritative surface REVEALED it — saw it, and
no discovery surface ever did. MEASURED after a full live pass: **143 of 146 Datadog kinds** are
in this class, and the three that clear are the three above.

**Two things that pass measured into existence, both first-class.** A first-page-only read is a SUCCESS
that is not `synced`, so `DatadogReadOutcome` carries a third `bounded` arm: reporting it as a failure would
put `latestAttemptFailed` on a cell nothing went wrong in, and reporting it as complete would earn it
`synced`. And 19 kinds answered 400 NAMING a required query parameter — the same class as a path parameter
one field over — so `MISSING_PARAMETER` reads Datadog's own words (`missing parameter "page_id" in "query"`)
and grades the kind `deferred` with that parameter in its `unblockedBy`, rather than `unreadable`, which
would have said the ANSWER was malformed when it was the request.

**`console` divides by the LIVE left nav, on the owner's word, and `atlas datadog walk` fills it.** Datadog publishes
no sitemap — MEASURED, `GET /api/ui/cmd-k/navigation-mappings` is the command palette's 43-route
shortcut table, and walking it would have been a subset presented as a surface, which the owner's
ruling refuses. The owner chose re-reading the left nav live over accepting an earlier
recon's 197 pages: `src/atlas/datadog/consolePages.ts` is that read (one hover per section
in the owner's own Chrome, the org's own dashboards, a team link and the mobile-login QR excluded by rule), and the
descriptor declares `known: true` against it. The walk visits every declared page through the page transport,
then takes two read-only arms of its own (`src/browser/datadogConsole.ts`): `datadog-nav-observe` hovers the
nav again and raises `console-nav-drifted` in BOTH directions, so the hand-carried list is checked rather than
trusted on every run; `datadog-palette-observe` presses the palette's own chord and captures
`POST /api/ui/search/suggestions/entities`, which answers 401 to API keys. Two kinds carry the result —
`console-page`, `console-request` — and every console call whose method and path shape match a registry
template lands on that operation's `console` channel, closing `console-never-walked` for its kind. The
palette body is reduced to a count per entity kind; no name it lists reaches disk. Filled needs every route
attempted AND the nav re-read with no drift (`surfaceFill.ts`).

**A BOUNDED walk says so.** `--limit` is for proving the lane, and the published coverage says so: the bound
reaches `walkDatadogConsole` itself (`boundedRoutes`) rather than slicing `DATADOG_CONSOLE_ROUTES` before the
walk sees it — sliced early, `notAttempted` comes back empty, `walkTally` reads a whole console and a
three-page smoke run publishes the console surface `synced`, the class the `atlas-content-coverage` gate
exists to refuse. The routes past the bound come back as `omitted`, and `complete` reads BOTH that and `notAttempted` — kept apart
because a bound and a lost session have different remedies, and the cell prints whichever one applies.
Witness: `consoleSurface.test.ts` § "grades a --limit walk deferred, naming the bound rather than the
session", which reports `synced` against the early-slice arithmetic.

**Each page row carries what the capture SAW against what it KEPT.** `responseAccounting` rides through
to the stored `console-page` detail verbatim, for the reason `kit/frontierContract.ts` states about its own
copy: a page that lost two of twelve response bodies otherwise reads exactly like one that kept all twelve —
it still has its screenshot, its status and its title — and `console-request` is built from those bodies, so
the difference is the atlas's own completeness. The field is OPTIONAL: a generation cut before it existed
measured nothing, and absent means unmeasured rather than clean.
