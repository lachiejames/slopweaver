---
paths:
  - "src/atlas/**"
---

# Working in `src/atlas/`

One atlas per SaaS platform: everywhere information about it can be found, mapped, stored outside git and
read back with its claim boundary attached. Scoped to this tree; what an atlas IS is the owner's definition in
[atlas-intent](../../docs/atlas-intent.md), and how a session reads one is [the atlas skill](../../skills/atlas/SKILL.md).
This file is the contracts you break by editing here without knowing them.

**It states the norm and what new code does, not an inventory.** A file that predates a rule, and each gate's
blind spot, is named in that module's own header, which wins where the two disagree; a deviation you meet is
debt to record, never a licence to copy it.

## A platform is ONE row, and the row is cheap to import

`registry.ts` holds every platform exactly once, and every generic verb — `slopweaver atlas <p> <verb>` —
resolves through that row rather than through a switch in the CLI. One dispatcher
(`src/cli/commands/atlas/platformRun.ts`) serves every platform, and the `atlas` noun's manifest BUILDS a row per
registration (`src/cli/manifests/atlasPlatformMeta.ts`). So a new atlas is a `descriptor.ts`, a `readAdapter.ts`
and a `registration.ts` beside them, named as the `atlas` feature of its integration's manifest
(`src/integrations/<id>/integration.ts`) — `registry.ts` DERIVES its rows from `src/integrations/registry.ts`,
so there is no line to add here, no verb file, no manifest row and no test file of its own. `sync` is per-platform by design, because acquiring a platform is exactly the part that is
not shared. `reset` is the one conditional kit verb, declared as `readReset` on the registration; some
platforms still carry an own `reset.ts` and `resetRun.ts` until the `fold-atlas-reset-rest-291-54` board row
converts them, so never add another. [Where it lives](../../docs/atlases/where-it-lives.md) is the whole map;
the verb shells under `src/cli/commands/` are [area-cli](area-cli.md)'s.

**A registration is strings and `import()` thunks only.** Every row is imported eagerly (through its manifest), so a
static non-type import inside one `registration.ts` makes the cheapest verb in the noun load that platform's
whole model. `unit/atlas/registrationLaziness.test.ts` is the witness; `registryVerbs.test.ts` pins each
platform's verb list and `registryCoversEveryAtlas.test.ts` fails a descriptor on disk that no registry row reaches.

## What an atlas says about itself is a TYPE, not a convention

`kit/contract.ts` encodes the owner's definition, and each property below is a type there because getting it
wrong produces something that looks like an atlas and is not one:

- **One platform, several surfaces.** The API and the browser are two SURFACES of one atlas, never two
  atlases; how a surface is acquired is internal and the catalogue never keys on it.
- **A declared-but-unfilled surface is a STATE.** `declared-unfilled` is honest; not declaring the surface
  is not. The status vocabulary is kit-owned and CLOSED — a platform never adds a state of its own, and a
  genuinely new one is a pull request against that line, which is how `held-elsewhere` arrived.
- **`held-elsewhere` is not `excluded`.** One says a named store holds this fully, the other that we chose
  not to reach it; reporting the first as the second makes a covered platform read as empty.
- **Provenance carries the link and the link's provenance** (`deepLinkStatus`): provider-provided versus
  browser-discovered is what shows whether a browser surface ever ran.
- **Nothing refuses an undocumented endpoint.** `documented` records a fact for a reader to weigh; no kit gate
  consults it.

A descriptor's `status` is static in source, and that is the trap: a surface declared `filled` reads filled on
every install, an empty one included. So a surface stays `declared-unfilled` until a walk has really reached
it (the Linear and JumpCloud descriptors say why), and a zero is judged on the stored coverage cells below.

## A zero is answered only when it was MEASURED

`kit/readAnswer.ts` is the claim boundary in code. A generic `read` describes STORED RECORDS; when nothing
matched and ANY selected kind cannot establish that a zero was ever measured, it refuses rather than printing
zero. What makes a zero unprovable is a closed list of facts on the record — no coverage cell for the
surface, a cell in any state but `synced`, never a success, a failed latest attempt, a permission block, an
open gap, a manifest disagreement, freshness `never-synced` or `indeterminate` — and its header states each.
What it deliberately ALLOWS is the header's own list: a historical zero whose latest attempt succeeded,
answered with its date attached, a partial positive, and a field inside `detail`, which is never judged. The exit
codes a caller branches on are [the atlas skill](../../skills/atlas/SKILL.md)'s table; widen the list in that
header, never by special-casing one platform's read.

## Publication is the kit's, and a failure leaves the old generation standing

`kit/publish.ts` is the one generation protocol: every kind file first, the manifest LAST because it names
them, a digest per file, every document validated before the first byte is written, and the set installed by
rename through `kit/generationSwap.ts` so a failed install rolls back. One residue is stated in that header,
not closed: a process KILL mid-commit runs no rollback and leaves the prior files under `.superseding`,
recoverable by hand. A reader never repairs: a half-written, mismatched or stale generation is REPORTED, and
a corrupt atlas is never read as empty.

- **A manifest is a `.json`; a kind file is a `.jsonl`.** A kind file is bounded by the TENANT, not by this
  code, so `atlasFile.ts` writes the envelope on line 1 and one entity per line through `writeFileAtomicStream`
  and reads it back through `readJsonlLines` — never one JS string ([TypeScript patterns](typescript-patterns.md)).
- **Whether a generation may publish is judged once, in the kit** (`kit/mandatoryKinds.ts`). The owner's
  ruling there is the rule for this whole tree: a change is never made for one atlas alone; it is made so it
  applies to all atlases. A gap measured on one
  platform is fixed in `kit/`. A refusal that genuinely belongs to one platform goes through the kit's
  `guardPublish` seam (`kit/publish.ts` runs it; Linear's cross-workspace guard is the case), never a private path.
- **Where it is stored is not this tree's decision.** A generation lives under `$SLOPWEAVER_HOME/atlas/<p>/`,
  resolved by `src/atlasHome.ts`; `platformPaths.ts` matches a platform name to the atlas directory `stateHome.ts`
  already built and derives no home path of its own, so `stateHome.ts` stays the only contract.

## Two gates are written for this tree, and neither has a marker

Tree-wide gates (`whole-file-json`, `no-silent-fallback` and the rest) read it too; these two exist for it.

- **`atlas-content-coverage`** (`src/devLint/atlasContentCoverage.ts`) — coverage is divided by what EXISTS, not
  by what the atlas calls. A known surface's `reached` and `exists` are ratcheted SEPARATELY: neither may
  fall, and a rise in either is recorded in the same change, so a newly found endpoint is never a regression.
  A surface `filled` while its own denominator says something exists and it reached none of it never lands
  (0 of 0 is allowed, and the header says why).
- **`atlas-manifest-clock`** (`src/devLint/atlasManifestClock.ts`) — stamping a manifest's `kinds` belongs to
  `kit/`; a function outside it that spreads a parameter and assigns `kinds` is refused.

## Estate facts are STATE, never code

An INSTALLATION's gotchas, caveats and numbers live in its generation under `$SLOPWEAVER_HOME` and in the
knowledge register, never in this tree, a skill or a rule (an owner ruling). A fact about the provider's own
code is different: `make/descriptor.ts` keeps the pinned SDK's read-only census as a constant its test
recomputes. A comment may describe a measurement that shaped the code, with its repro command; it never
becomes the place an installation's facts are kept.
