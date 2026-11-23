# The Trelica atlas holds the entities, and its three surfaces have three different keys

Part of [Atlases](../atlases.md).

This is the platform the per-platform test (`docs/atlas-intent/06-holdings.md`) comes out the other way on: it is the
organisation's own SaaS-discovery product, so nothing better suited holds its application inventory, its
vendors or its spend. The atlas therefore holds **everything reachable, entities included** — and the
surface map sits beside them rather than instead of them. The integration catalogue is the one declared
exception: of its providers, only the connections this tenant holds are kept.

**What a real run found, and it is the reason the three channels are kept apart.** MEASURED,
reproducible with `slopweaver atlas trelica refresh`:

- **The vendor publishes OpenAPI documents the tenant serves to any signed-in browser, and the API they
  describe answers `403` to that browser's own session cookie.** It authenticates an OAuth2 client this
  installation does not hold. So the published surface is MAPPED in full and INGESTED from not at all, and
  those are two coverage cells rather than one: `published-api` is graded on the map, `published-api-data`
  says `not-configured` and names the API key that would fill it.
- **Its own web client names four documents and the tenant serves two of them.** The other two answer `404`,
  and each is a gap carrying the document's name — a fact about the platform, where a hand-written endpoint
  list could only ever have been a fact about this repository.
- **The undocumented first-party surface is where the entities actually live.** The organisation-wide
  application inventory is a `POST` the web client makes with an antiforgery token, and it is the
  browser-is-the-fallback ruling (§7) applied rather than restated: the atlas ingests through that API and
  the browser walk stays evidence about the SURFACE.
- **A route this single-page client does not have answers HTTP 200 with the bare product title and no
  first-party call at all.** Four such routes were graded "reached" by a status-only rule before
  `isTrelicaEmptyShell` was added, so reachability here is judged on origin, path AND whether the page did
  anything.
- **The indistinguishable-screenshot check caught a real one on its first live run.** A declared page
  redirected to the catalogue and photographed the catalogue's own bytes; both pages lost their screenshot
  claim and each raised its own gap, because two declared pages that are the same picture evidence nothing.
- **The two application lists share the TENANT's row id, never the vendor's global `applicationId`.** Keying
  on the latter published more applications than the tenant holds, because every catalogue row became a
  second entity for one the inventory already held. Catalogue rows matched an inventory `id`, and none matched
  an inventory `applicationId`.

**AI spend comes from the tenant's cost explorer.** It is reached under the AI Consumption permission. The
spend shows nowhere else: every application's `lastYearSpend` in the inventory reads 0. Measured:

- **Six org-wide reads, one per grouping the explorer offers**: application, team, cost centre, model, API key
  and person (`aiUsage.ts`). Each is a `POST` whose body carries the date window and pages the table INSIDE the
  body, so the reads are a second closed table beside `inventory.ts`, not rows in it. A caller names a
  dimension, never a path, and the `GenerateSampleData` mutation in the same service is unreachable. A model
  row with an EMPTY model name is the provider's own no-model bucket and is held as `(no model recorded)`.
  Only a row with no key at all is left out.
- **The window is two years, so the explorer answers a monthly series.** The explorer picks the series
  granularity from the window's length: 30 days gives daily, two years monthly, six years yearly. The
  granularity each row was answered at is stored, not assumed.
- **The API-key table is long, and almost all of its rows are fractions of a cent.** These are per-run
  evaluation keys. Every key at or above $1 is held. The rest is the `ai-usage:api-key-tail` coverage cell,
  which records the tail's count, its largest key and the most the tail could sum to. Nothing goes unreported.
- **Alerts and budgets.** Spend-spike and budget alerts are `ai-alert` rows. No budget record shape has been
  measured, so the atlas only counts budgets,
  and the first one to appear raises `ai-budget-shape-unmeasured` rather than being stored under a guessed
  shape.

**People, workflows and their runs, integrations, contracts, devices, teams, access reviews and assessments**
are nine more kinds. Each is one first-party read, listed in `entityInventory.ts`, and each is admitted by a
strict per-endpoint boundary (`workflowBoundaries.ts`, `peopleBoundaries.ts`, `estateBoundaries.ts`,
`assuranceBoundaries.ts`). A boundary refuses a drifted key by name, and when it does, that kind keeps what the
generation already held. Measured:

- **A run's list row says how it ended, but never which step did what.** A run can end
  `CompletedWithErrors` with an `errorCount` of 0. So each run's own detail (`GET /FlowApi/FlowItem/{id}`) is
  read for its step states. Each step is named from the definition version the run actually ran
  (`GET /FlowApi/Flow/{id}/{version}`), because one workflow's runs can span many of its versions. A run that has
  not moved since the last sync reuses the steps already held. A run whose detail could not be read keeps its
  row with `steps: null`, and the kind is deferred, so the manifest never dates a short sync as complete.
- **Both path-param reads accept only the platform's 24-hex record id.** Nothing a response carries can steer
  a read to a different endpoint.
- **Devices are the one kind over the row ceiling, and they are held whole.** The first sync refused the
  device rows as undeclared. A device is inventory keyed by its own id and re-read in place, not a time series,
  so `volume.ts` declares it `bulk-entity`.
- **What these reads carry and the atlas never holds:**
  - a run's `baseScope.variables`, which can carry a password-named variable;
  - every step's request log, event log, outputs and scope;
  - a step definition's credentials, headers, URL, body and fixed password;
  - an integration's connection configuration;
  - a contract's documents;
  - every source's `externalId`.

  Each one is declared in its boundary and read by no projection. Provider-written text (a failure message, a
  fired error, an integration's last error) is held only as a closed value: a measured `flow_…` code or `Awaiting…`
  state, or a status line whose reason is the standard phrase for its status. Anything else is withheld, because
  neither a scrubber nor a syntactic shape tells a short echoed password apart (`providerText.ts`). The line is
  free text a provider or integration WRITES. A platform state or type, such as a person's status or an
  integration's sync status, is Trelica's own vocabulary and is held as Trelica sets it. A run's and a step's state
  is closed anyway, against its measured set with any other value held as unrecognised (`heldTrelicaState`),
  because the offboarding verdicts branch on it. Every kind file
  write re-holds it, closes a stored run's own state and each of its steps' states again, and prunes beneath any
  secret-bearing key name, and the offboarding report's reader re-holds it
  too, so an older generation never carries either forward.
  The method map's field census never sees beneath one either: every Trelica boundary is a
  `defineTrelicaBoundary` (`trelicaBoundary.ts`), whose census view keeps a declared-unread key as `null`, so the
  map records that an endpoint answers `parameters` and no name under it. A body the web client fetched has
  no schema, so the browser census prunes by name instead (`TRELICA_SECRET_BEARING_KEYS`, `browserReduction.ts`).

  The run list, integrations page and audit log are never photographed (`TRELICA_UNPHOTOGRAPHED_PAGES`,
  `browserPages.ts`). Each renders text a provider wrote, and nothing can re-hold pixels, so what they show is read
  through the API alone. A walked page that is not held as declared, a redirect above all, keeps no screenshot
  either, because the client can send a declared page to one of those three (`storeScreenshot`, `browserWalk.ts`).
  Nor does it keep the address it landed on: a settled address is held as a declared page path, the tenant's own
  sign-in path (`/Account/Login`, where a lost session now lands), the vendor's sign-in origin or a
  fixed marker, never as the client wrote it (`trelicaHeldFinalUrl`, `heldAddress.ts`, whose sign-in test the hand
  recheck shares). No page's title is held as written either, since a page can title itself with a provider's
  error: only the bare product title is, and any other is the withheld marker (`trelicaHeldTitle`). Pixels cannot be closed the same way, so a declared page that
  shows a provider's error in its own body is photographed as rendered; that residue is why the three pages known
  to show provider text are never walked.

`slopweaver atlas trelica report --offboarding` joins people, workflows and runs into one view. It prints:

- each offboarding workflow's current configured steps in order, a repeated name kept as its own step, each with
  what it is set to do: the integration pipeline it runs, its delay and timeout, the licence it sets, the channel
  and people it messages, whether it asks for approval (`stepSettings.ts`). Two definitions with the same ids,
  order and version that differ in one of these settings read differently, and so do two whose trigger fires for
  different person types or differs on approval. The message body, request material and integration input values
  beside them are never read, and a recipient is held by name, never email. A licence's label and plan id are the
  integration's own text, so only a measured one is held as written and any other is the withheld marker
  (`heldTrelicaLicence`). Some non-secret settings stay
  declared and unread too (a task's assignees, an asset filter, a branch condition), so a change to one of those
  does not reach the report;
- per step, keyed by its id and never its name, the outcome tally and the commonest failure; then the steps only
  an older version had;
- every current leaver whose evidence needs a look;
- apart from them, everyone a run names whose current record does not say they have left.

**A leaver is someone their own current record says has left** (`offboardingStanding.ts`): `Terminated`, or
flagged a leaver with a due date. A run is not that evidence, because it names a rehire or a test as readily.
**A run's states record what the workflow EXECUTED, not what a provider now holds.** So the best verdict is
`run-clean`, never "offboarded properly". A leaver with no run is named only when the run was due: before the
generation's own date, and after the first offboarding run. The report reads one validated snapshot, and it
refuses when any of its three input kinds is not vouched for, was never read whole, or failed its latest read.

**Where the tenant lives is never in this repository.** Every customer gets a subdomain that is the
organisation's own name, so it is read at runtime from `$SLOPWEAVER_HOME/secrets/trelica-tenant-host` and
nothing guesses one — the same posture as the CrowdStrike API host, for the same reason. No verb here prints
a URL, in either report shape.

**What it deliberately does not hold:** every mutation on every surface (`inventory.ts` is a closed table of
GET and list-shaped calls, so a write is unreachable rather than unused); the vendor's own staff recorded
against an application; per-person licence assignments and seat lists; spend transactions and audit
activity, which take the voluminous disposition and are declared rather than stored row by row; and the
session cookie and antiforgery token that authorise the first-party channel, which `session.ts` returns to
no caller and prints nowhere.
