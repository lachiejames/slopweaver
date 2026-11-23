# The Nightfall DLP atlas is the one whose compiled surface is its whole deliverable today

Part of [Atlases](../atlases.md).

It maps the organisation's data-loss boundary — the complement of the CrowdStrike atlas, endpoint on one
side and data egress on the other — and it holds **everything reachable** on the §6 test, because nothing
else on this machine holds Nightfall's view of the fleet.

**Six published OpenAPI documents, 56 operations, and the SERVER is part of an operation's identity.** The
vendor publishes no OpenAPI repository; the documents are what its own API-reference pages load, and
`atlas/nightfall/generated/specLock.ts` pins each by URL, digest, byte length, title, server and operation
count. Reproduce the discovery with

```bash
curl -sSL https://help.nightfall.ai/developer-api/nightfall_apis/dlp \
  | grep -ohE 'openapi\.gitbook\.com/o/[^/]+/spec/[A-Za-z0-9_.-]+'
```

The identity point is a measurement rather than a formality: `GET /events`, `GET /events/search`,
`GET /asset/activity` and `GET /actor/activity` are each declared TWICE, once under
`api.nightfall.ai/exfiltration/v1` and once under `api.nightfall.ai/posture/v1`, with byte-identical path
templates and different contents. An earlier scrape of the vendor's rendered documentation pages folded
twelve operations into six for exactly that reason, which is why the row carries the server and the provider
key is `<METHOD> <server><path>`.

| Disposition   | Rows | What it means here                                                                                                          |
| ------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `entity`      | 21   | called, projected and stored — the AI-governance and endpoint inventory                                                     |
| `shape-index` | 17   | the detection feeds: violations, findings, exfiltration and posture events and their activity feeds                         |
| `probe-only`  | 0    | the vendor publishes no credential-validation endpoint at all, so this is a fact about Nightfall rather than an unused idea |
| `excluded`    | 18   | inventoried and never called — every write, plus the scan family                                                            |

**The voluminous rule cuts cleanly here, and there is a second reason it has to.** The workflow APIs return
two utterly different things under one bearer token: detections the product NOTICED at an instant, and
inventory somebody or something created. The first is the highly-voluminous class by
[atlas-intent](../atlas-intent/06-holdings.md) §6, and it is also, by construction, a description of the sensitive data the
product exists to protect — the vendor's own `Finding` component declares `redactedSensitiveText`,
`redactedContext` and `redactedLocation`. So the shape is stored and the rows are not, and that is enforced
at the FILE boundary: `atlas/nightfall/store.ts` refuses a whole generation carrying a stored record of a
shape-indexed kind, whoever wrote it.

**The gate reads a declared family, never a name prefix — the general lesson.** A `providerId` prefix
criterion reads all 56 operation entities as detections, because every one begins `GET https://…` (measured
on its first generation): a string-prefix criterion silently changes meaning when a naming convention moves.
The entity DECLARES its `family` — `operation`, `record-shape` or `record` — and the schema validates it, so
getting it wrong is a parse error rather than a wrong verdict.

**Its best finding needs no credential: the API can say a violation fired and cannot say which rule fired
it.** A `Violation` declares `detectionRuleUUIDs`, `detectorUUIDs` and `policyUUIDs`; a `Finding` declares
`detectorUUID` and `subDetectorUUID`; exfiltration and posture events each declare `policyUUIDs`. **No path
in any of the six documents lists policies, detection rules or detectors.** Only the console resolves those
identifiers, which is an independent reason the browser surface here is mandatory rather than a completeness
ritual, and `surfaces.test.ts` asserts the absence so the finding cannot go stale in silence.

**Two of three surfaces are `declared-unfilled`, and each says what would fill it.** MEASURED:
no `nightfall-*` entry exists under `$SLOPWEAVER_HOME/secrets` and all 56 operations declare `bearerAuth`, so
`workflow-api` is unfilled pending `slopweaver secrets set nightfall-api-key`; and
`slopweaver browser cookies --origin https://app.nightfall.ai` reports no session in the owner's own Chrome,
so `console` is blocked on a sign-in that is the owner's to perform. A device-provisioning credential is not an
API one, and this atlas neither reads nor stores one.

**The official Node SDK is not the authority, and measuring that was the point.** `nightfall-js@1.1.2`
declares five operations, all of them POST or PATCH against the scan API — nothing an atlas can read. It is
deliberately NOT a dependency of this repository, which is the opposite call to the Datadog atlas's pinned
client and is what the evidence supported.
