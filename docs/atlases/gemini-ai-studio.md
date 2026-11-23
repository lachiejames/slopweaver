# The Gemini / AI Studio atlas is a SURFACE MAP, and it names the store that holds its entities

Part of [Atlases](../atlases.md).

This is the atlas that came out the OTHER way from its Microsoft 365 sibling, on the same test. Nothing else
here holds the Entra directory, so that atlas holds everything reachable; here something better suited already
holds what matters — this organisation's Gemini footprint is a Google Workspace fact — so by
[atlas-intent.md](../atlas-intent/06-holdings.md) §6 this atlas maps the INTERFACE and holds no entity of its own. Four
things about it are worth stating rather than rediscovering.

**Every kind carries a `held-elsewhere` cell naming the Google Admin atlas, and an open gap saying what that
holder actually is.** `held-elsewhere` is not `excluded`: `excluded` invites a reader to treat the data as
unavailable, and it is not — it is somebody else's. But `kit/contract.ts` requires such a cell to name WHERE,
and a name a reader cannot follow is the unfalsifiable claim the state exists to prevent. It first named the
BOARD ROW rather than a verb, because the verb did not exist.

**The verb exists now, and it did not turn out to be a store.** The Google Admin atlas landed as a SURFACE
MAP on the same §6 test that made this one a surface map, so the cell names
`slopweaver atlas google-admin read` and the sync raises `entities-holder-is-a-surface-map` on every kind.
That holder maps the licence assignments, the Chrome and Workspace policy schemas and the usage reports,
with the administrator scope each one needs. Its own `admin-api` surface fills under a readonly
administrator grant — MEASURED: dozens of operations answered and thousands of record shapes were stored. **Read what a
filled cell holds before citing it**: a record is stored as its key and its field NAMES, never a value, so
the cell still says "here is where they live and what it would take to ask" rather than handing over the
data.
The fold the board row invited does not happen either, and the reason that survives is not the one first
written here. It was sequencing — the fold becomes attractive once the holder exists — and that reason
expires the day the holder lands. The real one does not: two surface maps do not fold into one another. If a
Gemini entity store is ever wanted it is a third thing, and neither of these is it.

**It compiles all THREE published versions, and that is where the finding is.** MEASURED
(reproduce with `slopweaver atlas gemini-ai-studio sync --json`): **222 operation declarations across `v1`,
`v1beta` and `v1alpha`, folded into 89 operations over 13 resource roots** — 28 reachable, 4 voluminous, 57
excluded. `v1beta` and `v1alpha` declare exactly the same 85 operations with the same shapes, so the compiled
channel produced ZERO version disagreements on that revision. **Four operations exist in `v1` and in NEITHER
pre-release version**: `operations.list`, `operations.delete`, `media.download` and
`tunedModels.operations.cancel`. A reader who knows only `v1beta` — which is what most Gemini documentation
shows — would conclude the API offers no way to list a long-running operation. It does, on the stable version.
That is precisely the unknown unknown compiling all three exists to surface, and it is invisible in any one
document.

**Google's own bytes are not stable, so the pin hashes a CANONICAL form.** MEASURED the same day, and it is a
property of the vendor rather than of this code:

```bash
for i in 1 2; do curl -fsSL 'https://generativelanguage.googleapis.com/$discovery/rest?version=v1' | shasum -a 256; done
```

Two fetches seconds apart return 245,003 bytes each and two different SHA-256 digests — identical content,
different object key order. A digest over the served bytes therefore pins nothing and a cache keyed on one
never hits, so `specSource.ts` hashes the document with its keys recursively sorted instead, and the canonical
digest DOES reproduce. The pin is also a WITNESS rather than a gate, unlike the Microsoft 365 atlas's: that one
addresses an immutable git commit, where a mismatch can only be corruption; this endpoint is live by
construction, so a moved census is Google moving. A sync publishes what arrived and raises
`spec-revision-moved` carrying the exact deltas. What still REFUSES is the envelope parse — `kind`, `name`,
`version`, an eight-digit `revision`, and a `rootUrl` that is exactly the constant origin — which a
substituted or truncated body fails.

**23 AI Studio and Gemini app pages are DECLARED and none has been visited.** The list never shrinks (the
owner's ruling): an unreachable route becomes a gap against the page, never a deletion from
`browserPages.ts`. Two things a walk will have to handle are written down before they are discovered — both
products are single-page applications that answer 200 for a route that does not exist and render the error
inside the app, so a walk must grade on the rendered title and the page's own calls rather than on status;
and the Google Admin console's Gemini pages are deliberately NOT declared here, because those govern the
entities the `held-elsewhere` cell has already handed to another atlas, and declaring them would be a second
copy of somebody else's surface.
