# The all-atlas content audit — one table, every atlas, one honest number each

**Owner ruling:** a class of problem found in one atlas, Vanta's above all, is audited across every atlas,
because the same mistake was most likely made in all of them.

The number that says so is in the fifth column: when this audit began, **1 of 118 declared surfaces had a
denominator.** Every other one divides its coverage by this atlas's own list of what it calls, so it can only
ever read complete.

**The next measurement was 4 of 121, and the three that arrived are the argument for the whole field.** Vanta
publishes FOUR machine-readable API documents, not one, and this atlas was dividing by a single one of them:
the Auditor description declares 38 GET operations, Build Integrations 12, and the webhook description 24
outbound topics with no GET at all. All three path sets are disjoint from Manage's 107 — zero overlap between
any pair — so none of them was a second view of something already counted, and `/audits` turns out to live in
Auditor rather than in Manage at all. Declaring them honestly moved Vanta's never-called count from 82 to
**132** without a single call being lost, which is exactly the movement a composite ratchet could not
express. Re-derive the current position with `yarn tsx src/devLint/atlasContentCoverage.entry.ts`.

## The class, named exactly

> **A surface whose coverage is divided by the implementation's own list of what it calls.** An endpoint
> nobody thought of is then not a gap — it is an ABSENCE, and absences appear in no coverage report.

This is not the same as "an atlas that drops content", though it produces that. It is the reason the Vanta
policy body was invisible for as long as it was: a session established, correctly, that nine content-shaped
routes under `/v1/policies/{id}` answer HTTP 404, and concluded the Manage API had no body surface. What it
had no way to check was that `GET /knowledge-base/resources` — which serves every one of this
organisation's policy documents as a file — was in Vanta's own published document all along.

Reproduce every number below with `yarn tsx src/devLint/atlasContentCoverage.entry.ts`, which is also the
gate that refuses an increase in any of them.

## The table

| atlas                  |   kinds | surfaces | filled | denominators known | operations unreached | grounds that withhold a record                                                            |
| ---------------------- | ------: | -------: | -----: | -----------------: | -------------------: | ----------------------------------------------------------------------------------------- |
| `aether`               |       3 |        1 |      0 |                  1 |                    0 | `not-fetched`, `payload-not-map`, `secret-material`, `shape-index`                        |
| `airtable`             |      19 |        4 |      2 |                  0 |                    — | `secret-material`, `shape-index`                                                          |
| `braze`                |      17 |        4 |      2 |                  0 |                    — | `names-not-values`, `not-fetched`, `shape-index`                                          |
| `canva`                |      17 |        3 |      1 |                  0 |                    — | `payload-not-map`, `secret-material`, `shape-index`                                       |
| `clerk`                |       3 |        3 |      0 |                  0 |                    — | `held-elsewhere`, `names-not-values`, `not-fetched`, `secret-material`, `shape-index`     |
| `cloudflare`           |      66 |        2 |      1 |                  0 |                    — | `not-fetched`, `secret-material`, `shape-index`                                           |
| `crowdstrike`          |      10 |        2 |      2 |                  0 |                    — | `names-not-values`, `secret-material`, `shape-index`                                      |
| `datadog`              |     146 |        3 |      0 |                  1 |                  239 | `not-fetched`, `secret-material`, `shape-index`                                           |
| `figma`                |      18 |        4 |      2 |                  0 |                    — | `not-fetched`, `payload-not-map`, `secret-material`, `shape-index`                        |
| `gemini-ai-studio`     |      14 |        3 |      1 |                  0 |                    — | `held-elsewhere`, `names-not-values`, `not-fetched`, `shape-index`                        |
| `github`               |      18 |        4 |      3 |                  0 |                    — | `held-elsewhere`, `names-not-values`, `not-fetched`, `payload-not-map`, `secret-material` |
| `google-admin`         |      83 |        3 |      2 |                  0 |                    — | `held-elsewhere`, `names-not-values`, `not-fetched`, `secret-material`, `shape-index`     |
| `graphql-hive`         |       6 |        4 |      2 |                  0 |                    — | `secret-material`, `shape-index`                                                          |
| `hex`                  |       5 |        5 |      0 |                  0 |                    — | `disclosure-bound`, `names-not-values`, `shape-index`                                     |
| `inngest`              |      11 |        4 |      0 |                  0 |                    — | `names-not-values`, `secret-material`, `shape-index`                                      |
| `jam`                  |       5 |        5 |      0 |                  0 |                    — | `disclosure-bound`, `names-not-values`, `secret-material`                                 |
| `jumpcloud`            |      76 |        2 |      0 |                  0 |                    — | `secret-material`, `shape-index`                                                          |
| `knock`                |      32 |        5 |      4 |                  0 |                    — | `names-not-values`, `shape-index`                                                         |
| `linear`               |       4 |        2 |      1 |                  0 |                    — | `held-elsewhere`, `not-fetched`, `secret-material`, `shape-index`                         |
| `microsoft365`         |      71 |        3 |      1 |                  0 |                    — | `names-not-values`, `not-fetched`, `shape-index`                                          |
| `nightfall`            |      19 |        3 |      1 |                  0 |                    — | `names-not-values`, `secret-material`, `shape-index`                                      |
| `notion`               |       2 |        3 |      2 |                  0 |                    — | `held-elsewhere`, `not-fetched`                                                           |
| `nx-cloud`             |       5 |        3 |      2 |                  0 |                    — | `held-elsewhere`, `payload-not-map`, `secret-material`, `shape-index`                     |
| `onepassword`          |       7 |        3 |      2 |                  0 |                    — | `not-fetched`, `secret-material`                                                          |
| `prisma-data-platform` |      26 |        5 |      3 |                  0 |                    — | `names-not-values`, `not-fetched`, `secret-material`, `shape-index`                       |
| `slack`                |       2 |        2 |      2 |                  0 |                    — | `held-elsewhere`, `names-not-values`                                                      |
| `trelica`              |       4 |        3 |      3 |                  0 |                    — | `names-not-values`, `not-fetched`, `secret-material`, `shape-index`                       |
| `twilio`               |       5 |        3 |      0 |                  0 |                    — | `names-not-values`, `shape-index`                                                         |
| `vanta`                |      43 |        5 |      2 |                  4 |                  111 | `held-elsewhere`, `not-fetched`, `shape-index`                                            |
| `workos`               |       6 |        4 |      2 |                  0 |                    — | `secret-material`, `shape-index`                                                          |
| `xero`                 |       3 |        4 |      3 |                  0 |                    — | `names-not-values`, `not-fetched`, `shape-index`                                          |
| **31 atlases**         | **746** |  **104** | **46** |              **6** |              **350** |                                                                                           |

**The table is one measurement, not the live position.** `yarn tsx src/devLint/atlasContentCoverage.entry.ts` prints
the live totals and the shortfall the gate holds — a later run read 32 atlases (`google-secops` joined), 7
surfaces that can divide and 383 documented operations never called. The first two paragraphs above are
the two positions the row moved between.

**Read the last three columns together.** `filled` counts surfaces this repo says are populated;
`denominators known` counts the ones that can say what populated MEANS; `operations unreached` is only
computable for the six surfaces that can. 46 surfaces are declared filled and 45 of them cannot name a
single thing they never reached.

**And the ones that can are not flattering themselves.** Vanta's Manage figure is the count of documented
GET operations never CALLED, which includes the ones whose reason is good (a detail read of a collection
this atlas already walks whole) and the ones an entitlement refuses. It never subtracts those: a denominator
that forgives an endpoint because there is a good reason for it is the arithmetic this audit exists to end.

**The first movement DOWN this page recorded.** The eight documented GET
operations needing no identifier at all were called, so Vanta's Manage `reached` went 25 → 33 and its
shortfall 82 → 74; the twelve reachable by fanning out over a parent this atlas already holds followed,
taking `reached` to 45 and the shortfall to 62. Two things moved the other way in the same change and both are worth reading, because
they are the failure mode this page names. `covered-by-list` had been inferred from a path's SHAPE, which
cannot see whether the claim it makes — "the detail response carries the same object" — is true; measured
against Vanta's own document it was FALSE on two of the fifteen rows carrying it, `GET
/documents/{documentId}` answering six fields `/documents` does not and `GET /frameworks/{frameworkId}`
answering `requirementCategories`. Both are `not-fetched` now, and the generator computes the comparison
rather than assuming it. **A forgiven endpoint is worse than an unreached one**: an unreached endpoint is on
this page, and a wrongly forgiven one is not.

**The split inside it moved twice, once without the total moving at all.** First, `GET
/v1/vendors/{vendorId}/findings` was measured answering HTTP 403 while every sibling sub-collection of the
same vendor answered 200, so it left `not-fetched` for `entitlement-refused` and the split went 65/15/2 to
64/15/3 with the shortfall still 82. Then the eight identifier-free operations were called and the two false
`covered-by-list` rows corrected, taking it to 55/16/3 against 33 synced, and the fan-out families took it to
41/18/3 against 45. Later the integration resource walk — every resource beneath every resource
kind, held whole on the owner's ruling — took it to 39/19/3 against 46, its detail read joining
`covered-by-list` because both answer the same `AnyResource` object. Reproduce the measurement with
`yarn tsx tools/probeVantaGetEndpoints.ts`, which asks every documented GET on this credential.

## What each column is

- **kinds** — entity families the atlas declares. Not a size: `datadog` declares 146, and a count of
  families says nothing about how many records any of them holds.
- **surfaces** — declared places information can be found, API and browser alike.
- **filled** — surfaces the descriptor says are populated. `declared-unfilled` is honest and is the
  remaining 58.
- **denominators known** — surfaces carrying `denominator: { known: true, exists, reached, source }`. Six.
- **operations unreached** — `exists - reached`, computable only where a denominator exists. `reached`
  counts CALLS: an endpoint with a perfectly good reason for not being called still counts here, and the
  reason lives on its own row. Vanta's 111 starts with Manage's 61, which is 39 never fetched, 19 detail reads a walked collection already
  covers, and 3 an entitlement refuses — two measured at HTTP 403 directly, the third inherited from the
  collection it reads one of, which is refused before any id exists to ask it with. The remaining 38 and 12
  are the Auditor and Build Integrations documents, neither of which has a credential here. Datadog's 239 is
  the one other surface with a denominator and anything unreached.
- **grounds that withhold a record** — the exclusion grounds that actually drop data, as distinct from the
  ones that bound what the atlas DOES. `payload-not-map` is the one to read closely: it appears on five
  atlases and it is the ground the owner rejected for a Vanta policy body.

## The five `payload-not-map` rows, judged against the owner's ruling

The owner rejected `payload-not-map` reasoning for a policy: an atlas is meant to hold all the reachable
information inside its provider, and an organisation's own policy document is not a grey area.
So each of these deserves the same question — is this the platform's own product, or is it the
organisation's own authored document?

| atlas      | what it withholds                                                                                     | still defensible?                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aether`   | a finding's full write-up: proof-of-concept steps, request and response transcripts, exploit payloads | **yes** — it can carry a live exploit for a staging system that is still up, and the finding's identity and triage are held                                                                                                                                    |
| `canva`    | design content: a design, a page, an asset's bytes, a comment's text                                  | **yes** — a design IS the product, and storing them makes the atlas a second Canva                                                                                                                                                                             |
| `figma`    | rendered images and oEmbed fragments, S3 URLs Figma expires after 30 days                             | **yes** — an artifact to look at, and the nodes behind them are held                                                                                                                                                                                           |
| `github`   | private repository contents: files, diffs, patches, workflow definitions, CODEOWNERS, Actions logs    | **NO, and this is the closest sibling of the Vanta defect.** A CODEOWNERS file and a workflow definition are the organisation's own authored configuration, not GitHub's product. `slopweaver` reads them constantly through other paths; the ATLAS holds none |
| `nx-cloud` | cache artifacts and terminal logs                                                                     | **yes** — task outputs, emitted by machines                                                                                                                                                                                                                    |

**One of five is wrong on the owner's criterion, and it is GitHub's** — still declared in
`src/atlas/github/descriptor.ts`, and named here so the next session does not rediscover it.

## What this audit does NOT establish

- **It cannot rank the atlases with no denominator against each other.** Not having a denominator means
  not knowing the size of the hole; `jumpcloud`'s 76 declared kinds with neither surface filled and `slack`'s two
  fully-filled surfaces both report `—` in the same column, and they are not the same situation.
- **It says nothing about whether a stored record carries its VALUES.** A separate half of the same class,
  found by a Codex pass: fourteen atlases reduce an observed response to field NAMES through
  `responseFieldPaths` and store no value. That is visible in the `names-not-values` column and is a
  different rule from this one — the gate here counts reach, not content depth.
- **It is a snapshot of DECLARATIONS, not of disk.** Every number comes from the descriptors, which is what
  makes it checkable in CI with no credential. What is actually on disk is `slopweaver atlas doctor`.
