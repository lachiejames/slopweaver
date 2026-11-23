# The GitHub atlas is a SURFACE MAP, and it declares no entity kind at all

Part of [Atlases](../atlases.md).

Same ruling as Notion above — [atlas-intent.md](../atlas-intent/06-holdings.md) §6, "does something better suited already
hold this platform's entities?" — and the same answer, reached a different way. Every pull request, issue,
discussion, review, comment and commit is `src/corpus/github`'s, so this atlas holds the shape of the place
they live in: which operations exist, which settings pages exist, and what every one of those settings is
currently SET TO.

**Where it differs from the Notion atlas, and why.** Notion marks its page kind `held-elsewhere` and names
the holder, because a Notion page IS both a surface and an entity — the atlas has to declare the kind in
order to map it, and then say the contents live elsewhere. GitHub's entities are not surfaces: a pull request
is not a page this atlas maps, it is a record the corpus holds. So there is no kind here to mark, and the
boundary is stated in `excludes` instead. Both atlases owe a reader the same fact; the mechanism differs
because the platforms do.

**Four surfaces, three filled.** `rest-openapi` is compiled from GitHub's own published OpenAPI description
with no network call at all — measured against `@octokit/openapi-types` 27.0.0, **1,114 declared
routes**, of which **970 have a named method in the installed Octokit and 144 do not**, a disagreement
`atlas github report` prints. `rest-live` is the scoped token reading what each setting is set to, through
the closed inventory in `atlas/github/inventory.ts` — 25 GETs, each carrying its own `whyRead`, including the
two scope-DISCOVERY calls, which are in the table for a reason a review found: without them the ordinary
`sync` invocation sent two routes the closed list did not contain. At repository scope it reads what a
reproduction of the repository is given: the settings document (merge switches, description, topics), the
security-and-analysis switches, the Actions policy with its workflow defaults folded in as one entity, and
the label set. `github-web` is the owner's real Chrome, walked
through the Playwright relay. `graphql-schema` is DECLARED and unfilled, because an omitted surface would let
a reader take the REST half for the whole API.

**The browser half's denominator is a FRONTIER, not a manifest, and the atlas says so in every generation.**
CrowdStrike's walk is judged against Falcon's own published sitemap, so "98 of 553" is a number a reader can
check. GitHub publishes no authenticated settings sitemap — searched across its REST description,
its GraphQL schema documentation and its API root, and none was found, which is a scoped negative finding
rather than proof none exists. Measured separately the same week, its settings pages emit no navigation JSON
either. What GitHub does do is RENDER its settings navigation, so the walk starts from structural seeds and
expands over the links each landed page showed. Measured live, one account settings page rendered 51
same-origin links of which 39 were admin pages. That supports "every link GitHub rendered to me was followed"
and never "every admin page is in this list", so a permanently open `browser-denominator-unproven` gap states
the difference rather than letting a coverage fraction imply it.

**A walk earns `synced` only by CLOSING its frontier**, which means: a whole round discovered nothing new, no
page failed to navigate, no response body was lost, and no page's link read threw. Anything short of that is
`deferred`. Each of those four conditions was added because an adversarial review produced a run that staled
live configuration without it — a page whose link read failed being the sharpest, since the frontier is built
from links and a page that rendered them and could not report them looks identical to one with none.

**What it deliberately does not hold:** the value of any secret or variable at any scope, and no field exists
to put one in; a custom property's default VALUE, removed outright rather than screened; every token, key and
signing secret; a webhook's destination beyond its origin and a DIGEST of its path, because a path token that
looks like an ordinary route word is indistinguishable from one; a deploy key beyond a fingerprint;
code-scanning, Dependabot and advisory FINDINGS, which are entities rather than settings facts; private
repository contents of any kind; and response VALUES from GitHub's own web client, of which only the method,
path shape, parameter names and response field NAMES are kept — with any path segment that is not a plain
identifier redacted, because a value used as a map key is otherwise stored verbatim.

**Its success predicate is universal, both across kinds and within one.** This atlas requires every
mandatory kind to be either read or honestly absent, and requires that of EVERY scope and EVERY call feeding
the kind — one organisation syncing does not cover a second whose read was refused, and one call's success
does not erase another call's refusal at the same scope. It was written this way because `kit/coverage.ts`'s
`hasUsableCoverage` was `cells.some(...)`; that predicate was deleted, having turned out to be
reached by nothing but tests, and the kit fails a publish CLOSED in `kit/mandatoryKinds.ts` — see
[Publication fails closed](publication.md#publication-fails-closed-and-what-that-does-and-does-not-mean). This atlas keeps
its own predicate, because it answers the sharper per-scope question the kit cannot.
