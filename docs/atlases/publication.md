# Publication fails closed, and what that does and does not mean

Part of [Atlases](../atlases.md).

Owner ruling: both halves — fail closed on publish, and a profile that reads answerability — and no change
made for one atlas alone; a change applies to every atlas. So the refusal lives in the kit — `src/atlas/kit/mandatoryKinds.ts`, called by
`publishAtlas` — and every atlas inherits it by publishing at all.

**Every store spec declares `kindObligations`, and the field is REQUIRED.** A kind is mandatory unless the
platform declares it optional WITH A REASON, so fail-closed is the default and an exemption is the thing that
has to be written down. That direction is deliberate: an opt-in list of mandatory kinds makes a forgotten
declaration silently permissive, which is the failure this rule exists to remove. It is the owner's
ruling that an integration or atlas with no policy set must be structurally impossible, one level down. The declarations double as the measured gap list in code: `hex`'s `page`/`project`/`resource`, `jumpcloud`'s four shape-indexed telemetry families and
`cloudflare`'s plan-gated `api-gateway` each say in one line why nothing fills them.

**`kindVolumes` is the second required field on that spec, and it exists for the same reason** — the owner's
ruling: an atlas holds everything reachable EXCEPT highly voluminous data, which is stored as a
catalogued SHAPE and never as a row per record, and **the rule applies to every atlas**. `src/atlas/kit/volume.ts`
carries the type; `publishAtlas` refuses a generation that writes rows for a family its own atlas declared
shape-indexed, and refuses a kind over the row ceiling that carries no verdict either way. The measurement
that forced it: `jumpcloud/systeminsights.jsonl` held **hundreds of thousands of published entity rows** of
per-device osquery telemetry while its coverage cell read `synced`, in the same atlas whose descriptor
correctly declared two sibling families shape-indexed — in prose no code read. The three verdicts and when
each applies are [atlas-intent §6](../atlas-intent/06-holdings.md); the one worth knowing here is `bounded-observation`,
which is what lets Cloudflare keep the families §6's ruling measured and ruled in.

**What it refuses is narrow, and three designs were needed to get there.** The rule: a mandatory kind whose
file this generation WRITES, while the atlas has never once acquired it and the file holds no entities,
refuses the publish. Everything else publishes.

- Judging kinds the publish OMITS deadlocks a fresh home. There are 17 second-surface publishers; CrowdStrike's
  API run writes 8 of its 10 kinds and a separate console run writes the other 2, so neither can go first.
- Scoping the obligation to a per-kind publish GROUP fails the same way one level down — a browser surface that writes
  `method` and `page`, which the same atlas's API sync also writes, makes a browser-only publish re-trigger
  the whole API group.
- A generation in which NOTHING has ever been acquired is exempt, which is what keeps `atlas <platform> reset`
  working: it installs a deliberately empty generation through this same function.
- A kind that HOLDS ENTITIES is exempt. A partial read is not a fabricated placeholder — Cloudflare can answer
  410 on one of six firewall subtypes and still publish five real entities beside an OPEN gap naming what it
  could not reach. Refusing that would sink a batch for a failure the generation already reports.

**A surface the owner's PERMISSIONS do not reach publishes, and says so in a field.** Owner ruling:
an atlas finds all the reachable information the owner's permissions allow inside a platform, and the owner
is not an admin on most platforms, so a refused surface is the atlas working rather than a generation that
lies. The same ruling adds a first-class requirement: an agent must never have to guess whether coverage is
missing because the atlas is wrong or because of permissions — that has to be stated, not guessed.

So `src/atlas/kit/permissionBlock.ts` owns `AtlasPermissionBlock`: `at`, the platform's own `detail`, and
`unblockedBy`, the named grant that would lift it. Every atlas manifest schema admits it on a kind's status,
`kit/mandatoryKinds.ts` exempts a kind that carries one, and `AtlasKindView` carries it out to every reader.
Three rules make the exemption safe rather than a hole:

- **A block is stamped from a TYPED error, never from prose.** JumpCloud's `PERMISSION_REFUSED`, Cloudflare's
  `permission-refused` gap condition, GitHub's `SCOPE_REFUSED`. An atlas that has not classified its refusals
  stamps nothing and still fails closed.
- **EVERY failure on the kind has to be that one classification.** A kind refused on one route and broken on
  another is a boundary AND a defect, and calling it the first would exempt it on the strength of a failure a
  later run could clear.
- **`unblockedBy` is required.** An entry that cannot name the grant is describing a broken read.

**A product this ORGANISATION does not have publishes too, and is named in its own field.** Owner ruling,
generic for every atlas: a product the organisation does not have is validly excluded, since anything else
would be nonsensical.
The case was JumpCloud's `gcep`: the tenancy has no Google Chrome Enterprise Premium, the provider answers
404, and the gate above refused every publish because a never-acquired mandatory kind was exempt only for a
permission boundary. `src/atlas/kit/productAbsence.ts` owns `AtlasProductAbsence` (`at`, the provider's own
`detail`), a kind status carries it as `productAbsent`, `kit/mandatoryKinds.ts` exempts it, and `kindReason`
reports it as its own verdict so it never reads as a grant that would fill it. The stamping rules mirror the
permission ones: from a TYPED error only (JumpCloud's `ROUTE_ABSENT`), EVERY failure on the kind that one
classification, and NOTHING read — a 404 on one record among records the kind did read is a record gone, not
a product absent. An atlas that has not classified its 404s stamps nothing and still fails closed.

**The FIELD is half the ruling; the other half is that nobody re-derives what it means.** The owner asked for
it in one sentence — an agent must never guess whether coverage is missing because the atlas is wrong or
because of permissions — and a field alone does not deliver that, because the question a
reader actually asks is about the kind rather than about one field on it. Four readers each answered it with
a different predicate before `src/atlas/kit/kindReason.ts` existed, and one of them did not answer it at all:
`answerable.ts` called a kind never-acquired on `lastSuccessAt === null && publishedCount === 0`, which also
swallows a kind that WAS attempted and failed; `pageModel.ts` used a four-term disjunction over coverage
cells and gaps; `route/atlasReading.ts` restated `answerable.ts`'s pair structurally, so the two could drift
with no compiler to notice; and `atlas doctor` — the verb whose whole job is "is this atlas usable" — printed
no word for a permission boundary anywhere.

So `kindReason` decides it once, and every one of those four takes its answer:

| Verdict               | What it means                         | What closes it                     |
| --------------------- | ------------------------------------- | ---------------------------------- |
| `permission-boundary` | fenced, and the block names the grant | a grant — `unblockedBy`            |
| `product-absent`      | the provider says the org has none    | nothing; only adopting the product |
| `gap`                 | attempted and never acquired          | a fix                              |
| `not-attempted`       | no run has ever been here             | a run                              |
| `reached`             | holds entities, or read successfully  | nothing; this is the atlas working |

Three consequences are the rule rather than notes:

- **The boundary arm outranks every other**, and that is only safe because the STAMPING side above already
  refuses to write a block over a mixed failure. Read those two rules together or the precedence looks like
  a hole.
- **A kind read successfully that holds NOTHING is `reached`**, not a gap. That is a fact about the
  organisation, and reporting it as either of the other two arms is the same lie the field exists to end.
  Staleness is likewise not here: a kind that succeeded last week and failed today is `reached` with a
  failing latest attempt, because `kit/freshness.ts` owns currency and folding the two questions into one
  word is what made `lastAttempt.outcome` mean different things on different atlases.
- **`atlas doctor` never fails on a boundary**, in a sweep or on a named platform. A surface the owner's
  credential does not open is the atlas working correctly, so a red exit would send the fleet chasing a grant as though
  it were a defect. It prints the three lists per atlas and totals the fenced kinds across a sweep, and
  `--json` publishes all three as declared fields.

**What it does NOT close, stated so the next session does not assume otherwise.** Whether a kind that IS in
the publish set was read COMPLETELY is a per-platform question — `lastAttempt.outcome` means different things
on different atlases, measured at 42 failing tests when it was lifted into the kit — so it stays with each
platform's `guardPublish` and its own exit code. And a mandatory kind that no run ever writes at all is not
judged here by construction; the read side below is what refuses to present such an atlas as complete current
truth.
