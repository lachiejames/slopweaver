# The Knock atlas maps a platform with TWO published APIs, and a third of its product pages have neither

Part of [Atlases](../atlases.md).

Knock is notification infrastructure: workflows, guides, broadcasts, channels and the recipients they reach.
Nothing else in this installation ingests it — no corpus source knows a Knock workflow exists — so
[atlas-intent](../atlas-intent/06-holdings.md) §6's test comes out "everything reachable" and `kinds.ts` declares thirty
entity kinds beside the two that map the surface.

**Publish it, and read it back, with no credential and no network:**

```bash
slopweaver atlas knock sync        # both surface maps, offline, from committed registries
slopweaver atlas knock report      # where the two surfaces disagree
slopweaver atlas knock walk        # the browser half, in your own Chrome
```

**What was SENT is a different door.** `slopweaver knock` ([skill](../../skills/knock/SKILL.md),
`src/live/knock/`) reads messages, their events and their delivery logs live for an investigation, under a
key the owner mints, and stores nothing — so the paragraph above stays true: nothing
ingests Knock. Its strict boundaries pin the data API document independently of this atlas's own pin, so a
regeneration here never moves what that door accepts.

## Both surfaces are FILLED from artifacts the vendor publishes unauthenticated

This is the first atlas here whose route inventory is the application's own declaration rather than a
harvested or probed list, and the difference is worth naming because it changes what the walk can claim.

- **The API half is two documents, not one.** Knock's own documentation names
  `api.knock.app/v1/openapi` (the data API a product calls, 118 operations) and
  `control.knock.app/v1/openapi` (the Management API the dashboard is a client of, 98). Both are served
  unauthenticated, both are pinned by digest, and together they are 216 operations — 62 entity,
  16 shape-index, 1 probe-only and 137 excluded.
- **All 86 declared GETs were CONFIRMED to exist**, against six controls that all answered 404. Both hosts
  discriminate — a known path answers `401 api_key_missing` or `401 bearer_token_missing`, an unknown one
  a 404 whose body differs per host — so the whole read surface of both documents is corroborated against
  the live services by an installation holding no Knock credential at all.
- **The browser half starts from `_buildManifest.js`**, the Next.js route table the dashboard publishes on
  the same origin as its sign-in page. 154 routes, including ones this account's plan would never render.
  A probe establishes that a path answers; this is the table itself, so `docs/atlas-intent/06-holdings.md`'s floor —
  knowing every page that exists — is met exactly rather than approximately.

## The finding: 19 of the 57 pages a walk visits have no API behind them at all

Each route is mapped to an atlas kind and the kind matched against the operation registry, so this is
arithmetic rather than an assertion — and it recomputes on every regeneration. The four that matter most:

| Page                               | Why it matters                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/[slug]/agents`, `/agents/skills` | The Agents workspace — the FIRST item in the product's own navigation. Neither document declares an Agents tag, path or schema.                           |
| `/[slug]/settings/audit-log`       | No audit-log operation on either API. The surface a compliance question reaches for first.                                                                |
| `/[slug]/settings/api-keys`        | No operation reads an API key.                                                                                                                            |
| `/[slug]/settings/service-tokens`  | No operation reads a service token — so **the credential that would fill this atlas's API channel can be obtained through the browser and nowhere else.** |

The larger figure a reader may meet is 55 of 154, which counts every sign-in page, OAuth callback and error
route as well; those have no API behind them necessarily, so the gap list carries the 19 and the report
leads with it.

## Two more disagreements, and both are the API disagreeing with ITSELF

- **Nine declared GETs need an identifier NEITHER document produces**, and eight of the nine trace to one
  fact: no operation on either API lists an account's object COLLECTIONS. The whole `/v1/objects/…` tree —
  a recipient model Knock's documentation devotes a section to — is addressable only by a caller who
  already knows the collection name.
- **Sixteen operations need the OTHER credential** to learn what to call them with. Triggering a workflow
  by key, reading an audience's members and reading a recipient's channel data are all data-API operations
  whose identifier only the Management API produces. Each works; what is missing is that neither reference
  page says a second credential is required.

Two smaller facts a reader would otherwise have to measure. Knock pages its two APIs DIFFERENTLY —
`after`/`before`/`page_size` on the data API, `after`/`before`/`limit` on the Management API — so a client
written for one and pointed at the other pages correctly and silently takes the server's default size. And
the data API's `operationId` is not a name Knock chose freely: eight of its 118 carry a uniqueness
manufactured by appending a literal ` (2)`, which is why this atlas keys on `<API> <METHOD> <path>` instead.

## Seven declared pages are reached and never photographed, and the refusal is before the write

The walk visits `/[environment]/users`, `/objects`, `/tenants`, `/messages`, `/logs`, `/logs/runs` and
`/runs`, and writes no picture of any of them. A Knock recipient list is a page of real people's names,
email addresses and phone numbers, and a delivered message carries the notification's rendered body — the
owner's ruling names settings and admin pages as what a walk photographs, and is explicit that it must never
photograph every message ever sent.

`knockPhotographPolicy` is handed to `kit/pageWalk.ts`'s `photographPolicy`, so the bytes are never written
rather than written and then unreferenced. That distinction is why the field is required.

## What the first walk found, including a thing it could not settle

MEASURED, driving the owner's own Chrome. The dashboard's landing redirect named an account and
NO environment, so 26 environment-scoped pages were recorded as rootless with `--root <account>/<environment>`
named as the fix, and the 31 account-scoped pages were walked. **24 reached, 20 photographed**, every
screenshot a real render — density 0.084 to 0.218 against the 0.005 unrendered threshold
(`kit/browserWalk.ts`), so zero spinners.

The walk then stopped: **`/[slug]/settings/service-tokens` answered with a sign-in wall**, and a second walk
minutes later hit one on its first page. Two readings fit — the session expired between page 24 and 25, or
the page that displays credentials ends a session it does not like — and this atlas does not claim to know
which, because settling it means signing in and no agent here does that. What the run DID settle is a defect
of its own: a walk that lost its session had marked 56 pages stale that an earlier walk genuinely reached,
so `mergeKnockChannel` takes `staleAbsent` and a walk stales only when it ran to completion. "Absent
from this run" and "this run could not look" are different facts, and only the caller knows which.
