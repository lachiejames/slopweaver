# The Hex atlas is a SURFACE MAP because of a CONSTRAINT, and it is the first here to withhold a shape

Part of [Atlases](../atlases.md).

Hex is in scope as a surface map (owner ruling), with the explicit care that this atlas store
**no customer data locally**. That care is why this row does not come out the way
[atlas-intent.md](../atlas-intent/06-holdings.md) §6's test alone would send it: nothing else in this installation holds a
Hex project, collection or data connection, so §6 read on its own says "everything reachable, entities
included". It does not, because a Hex project is a notebook over the organisation's warehouse, and the thing
behind a handful of its operations is a result set. The owner's line is the design brief — a surface map holds the
existence and shape of projects and pages, never their result sets.

**That produces a THIRD disposition, which no sibling atlas has.** §6 gives two: `entity` for configuration
somebody created, `shape-index` for a time-series family enumerated and declared rather than stored whole.
`withheld` is Hex's own, and the difference from an exclusion is load-bearing. A withheld operation is mapped
in full — its method, its path, its parameters, its declared response field names, the credential it needs and
the URL a reader opens — and never called for its body. An atlas that dropped them would answer "Hex has no
way to read a cell's output", which is false. MEASURED across the published generation: **11 of 113
method rows are withheld** — nine of the document's 52 operations plus two of the client's 48 GraphQL ones —
and **4 are shape-indexed**, every one in the project-run family. `src/atlas/hex/disposition.ts` carries the
criterion so it decides an operation nobody has seen yet, and the two criteria overlap on exactly one real
path: `GET /v1/projects/{projectId}/runs/{runId}/cells/{staticId}/image` is inside the shape-indexed run
family AND renders a chart drawn from warehouse rows, so the stricter disposition wins.

**The withholding reaches the browser channel too, and there it refuses the SHAPE rather than the values.**
Every sibling reduction stores a captured body's field NAMES, on the reasoning that a name is what an endpoint
offers while a value is what the account holds. That reasoning does not survive contact with a data
workspace: a cell output's field names ARE the column names of whatever table the query ran against, and a
pivoted result promotes its values to keys. So `webReduction.ts` consults a result-bearing test BEFORE any
reduction runs, and a call it matches contributes a full row — method, path shape, host, call count, the pages
it fired on — with an empty `responseFields` and a stored sentence in `fieldsWithheldBecause` saying why. That
pairing is the point: on every sibling an empty field list means the body carried nothing, and here it can
also mean policy, and a reader who cannot tell those apart has been misled by a silence.

**Three surfaces are filled with no credential at all, and two of them find things the published API does not
declare.** The document Hex serves anybody at `static.hex.site/openapi.json` is 52 operations across 37 paths,
pinned by digest — and because that address carries no version, a release moves the bytes under it, so a moved
digest is compiled and reported as a gap rather than refused (`errors.ts`). Beside it:

- **An unauthenticated noun census, with two controls.** `app.hex.tech` answers `401` to a mounted `/api/v1`
  noun and a JSON `404` to one it does not have, so an anonymous request discriminates. MEASURED: **13 of 74
  candidate nouns are mounted**, and `suggestions` is mounted while the published document declares no path
  under it at all. The bound is measured rather than assumed, and it is recorded as its own control: an
  invented path NESTED under a mounted noun answers `401` too, because the router authenticates the subtree
  before routing within it — so this census is noun-level and can never be more. A mounted noun's row carries
  `*` as its method rather than a guess. Re-measure both controls with
  `yarn tsx tools/probeHexApiSurface.ts --verify`, which refuses in BOTH directions: if the depth control ever
  starts answering 404, Hex has begun discriminating deeper and a path-level inventory is compilable for the
  first time.
- **The shipped web client's own bundle graph.** On a single-page application neither the navigation surface
  nor the client's API is answerable from the rendered DOM, so `tools/generateHexClientSurface.ts` follows the
  login page's script tags and the webpack chunk resolver to a fixed point — **193 bundles, closing after one
  expansion round** — and reads the router table and the GraphQL operation names out of it. That yields **84
  route templates and 48 named GraphQL operations**, and the second number is the sharpest finding here: Hex
  addresses that API as `app.hex.tech/graphql?op=<name>`, and the published document declares **not one of
  them**. A whole first-party API sits outside the published surface, the same shape the Clerk atlas found in
  `dapi.clerk.com`. Because the graph is closed, these are not a sample: `--verify` refuses if either list
  moves.

**A template is visitable when it declares no REQUIRED parameter, and what is visited is the prefix before
its first parameter segment — the transferable part.** A React Router parameter ending in `?` is OPTIONAL, so
`/home/:subView?/:tabView?` is a template whose base path `/home` renders perfectly well; every surface a
person actually opens (`/home`, `/settings`, `/context-studio`) hangs off such a template. MEASURED: treating
any `:` as needing an id leaves 41 routes, almost entirely OAuth callbacks and test harnesses, and a walk over
them lands 17 pages, not one a human uses — while passing `doctor` and publishing a filled browser surface. That turns 84 templates into **56 visitable paths**, with 28
carrying a required parameter and recorded as a standing gap — a reader learns Hex has a project page; what
this atlas does not hold is a photograph of one particular project, which is §6's screenshot rule in Hex's
terms.

**Two more defects the walk found, and both are worth naming because neither is visible from the code.** The
sign-in wall lives at `app.hex.tech/login` — the SAME origin as every declared page, and at a route this atlas
declares — which no sibling walk has to handle: Twilio's console bounces to a different host, so its walk can
grade the wall by origin. A path test that did not know which route was ASKED FOR would report the owner
signed out every time the walk visited `/login` on purpose, and a `startsWith("/login")` test also matches
`/login-success`, which is a declared route of its own; because the walk stops at the first wall, that ended a
live walk on a page that had loaded fine. And `/login-success` is an OAuth completion page, so it closes its
own tab: the transport reports the session gone, and aborting on the first such report cost 14 of 56 routes on
two consecutive runs. A page that closes the browser is a property of the PAGE; the owner closing Chrome is a
property of the SESSION, and one loss cannot tell them apart — so the walk takes one more route before
deciding, and a visit that succeeds resets the count.

**A walk-level retry alone does not recover, so the TRANSPORT does.** MEASURED: a retry fails with the
identical message, still naming `/login-success`, when the transport keeps the first lost session sticky —
every scheduled `automation resync --atlas hex` failed that way until the fix, 24 of 56 routes unattempted
each time. Recovery lives in `src/browser/selfClosedGrade.ts` (`selfClosedTabRecovery`): a page closing its
own tab, whether the snippet reported it (client exit 0) or the client threw it (exit 1), triggers a fresh
attach and one retry; a page that closes the fresh tab too is graded `failed` on its own row and the walk
carries on in a new tab. MEASURED: `/mcp-server-oauth-result`, the route straight after
`/login-success`, closed its tab on the thrown path and stopped the walk, so the bound is two such pages with
nothing captured between (`MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE`), never the reconnect bit. An attach that
cannot reach a
browser still stops the walk. What remains of the walk-level rule covers a relay that will not come
back, and the `session-ended-by-page` gap names the route that reported it, so the remaining `not-attempted`
routes have a cause instead of a silence.

**What the browser half actually holds today.** MEASURED on the owner's signed-in app: 42 page
rows, 17 of them landed and photographed, 34 screenshots written, and 146 distinct operations the app's own
client called. Every one of those 146 is `report.ts`'s `browser-only` class — not one matches a published
operation — which is the same finding the GraphQL census makes from the other direction. Fifteen declared
routes went unattempted behind the `session-ended-by-page` gap above, and the atlas says so on the row rather
than reporting 41 of 56 as though that were the whole surface.

**What is still unfilled, and it is not waiting on evidence.** The `project` and `resource` kinds carry a
`not-configured` cell rather than being absent, and the only route to a Hex API token is minting one from the
workspace's own settings — a WRITE. Hex is in no `WRITE_POLICY_REGISTER` entry, so under the owner's ruling
it is `refuse-every-write` by default and the browser-door guard refuses that mint rather than allowing
it for want of a policy. The cell says so, and says the other half a reader needs: a token would fill those
kinds with what EXISTS and would change nothing about the withholding — a cell's output stays unfetched with a
token exactly as without one.
