# What atlases do NOT do

Part of [Atlases](../atlases.md).

- **They never answer a question.** An atlas says what exists. Deciding what it means is the visible
  session's job, exactly as it is for retrieval.
- **An atlas is not a measurement.** It says a method declares a field; whether a live call actually
  returns one is what `slopweaver slack probe` is for.
- **A disagreement between two surfaces is an OUTPUT, never a resolution.** `atlas slack-drive` records
  both records and raises a gap naming exactly which parameters and response fields one surface has and the
  other does not. Which surface wins is the owner's call and the owner has reserved it until they can
  see real instances — see [atlas-intent.md](../atlas-intent/04-corroboration.md) §4.
- **`sync` and `reset` write nothing outside `$SLOPWEAVER_HOME`**, so neither routes through the admit
  door. `atlas slack-drive` opens no browser at all — its `plan` half briefs a walk the visible session
  carries out in the owner's own Chrome through the `slopweaver browser` verbs, and its `sync` half reads the
  document that walk returns. **The brief is not a guarantee of read-only**: all five doored providers are
  `read-before-write` (an owner ruling,
  [browser-route](../browser-route/doored-provider-writes.md#and-then-all-five-moved) § "And then all five moved"), so a click on a page just READ is allowed. The walk asks for none — its steps are navigations
  and captures — so that bounds what this lane does, not what a wandering session COULD do. `atlas slack` makes no network call at all — it reads
  the local state `refresh` already wrote: the structure store, the thread cursors, and every Slack bronze
  window.
- **An atlas never reports a census over a corpus it could not read.** `atlas slack` walks bronze to answer
  both of its questions, and a window it cannot open is NAMED — a `SHORTFALL` block in the text rendering,
  an `unreadableWindows` array under `--json`, a warning on stderr — with the headline marked `PARTIAL`. The
  degradation this replaced looked safe and was not: a whole-file `utf8` read of a multi-gigabyte compacted window
  threw past V8's string ceiling into a bare catch, so almost the whole corpus vanished from the census and the
  coverage map at once while the verb printed confident numbers over a tiny remainder. Understating to zero
  without saying so is a wrong answer with no witness, not a safe direction.
- **`reset` never deletes.** It archives the current generation and installs an empty one, so a bad sync is
  recoverable rather than destructive.
- **A generation is published whole or not at all** (`src/atlas/kit/generationSwap.ts`). Every file is
  staged at `<destination>.publishing` — a sibling, because a rename is atomic only within one filesystem —
  and nothing is installed until the whole generation is on disk; the install then renames each file into
  place with the previous bytes parked at `<destination>.superseding`, so a failed install rolls back. What
  this replaced wrote each kind file straight over its destination and the manifest last, which made an
  interrupted publish DETECTABLE and never RECOVERABLE: a failure on the second of two kinds left the first
  holding the new generation under the old manifest, and `readAtlas` graded the last known good generation
  `mismatched` — not stale, unreadable. The residue is stated in that module's header rather than left to be
  found: a process KILL mid-install runs no rollback code, and closing that needs the whole generation to
  hang off one renameable pointer, a layout change across every atlas. A kill leaves the previous bytes under
  the `.superseding` suffix, so they are recoverable by hand, and the next successful publish of that kind
  overwrites both suffixes. Neither read path ever sees one: both iterate the platform's own kind list rather
  than the directory.
- **A schema bump SUPERSEDES a generation rather than migrating it**, and the refusal is the feature. Every
  atlas's store refuses a generation whose declared `schemaVersion` is not the one this build writes, naming
  its own `reset` as the remedy. The Cloudflare atlas is the first to use it: at version 2 a zone-scoped
  entity's id hashes the zone it was read from, so a version-1 generation is byte-valid and silently wrong —
  multiple zones collapse onto one — and the zone that identity discarded is exactly what a migration
  would need. An upgraded install reads nothing from that atlas until
  `slopweaver cloudflare reset --confirm archive` and a fresh `sync`; the archived generation stays on disk.
- **A pre-write gate that fires on ordinary data is a gate somebody turns off**, so an exemption is a
  named FIELD and a named SHAPE, never a widened pattern. `atlas/jumpcloud/shapeExemptions.ts` is the
  mechanism, built on the owner's ruling after device-inventory fields kept that atlas unpublishable. An
  entry is earned by READING the values that fired, never by the field looking innocent — an innocent-looking
  field can turn out to carry live credential material, which the gate is right to refuse. Each entry carries the walk that measured it, and it is paired with the
  opposite leg: the sync hands the gate the administrator key it authenticates with, refused verbatim
  wherever it appears and never exempt. Widening the heuristic and tightening it are the same change.
- **A field can also be WITHHELD under one endpoint alone, and under one SIBLING**, because a column's
  sensitivity can depend on where it arrives. `systeminsights/services` returns a Windows service's ImagePath
  in a column called `path`, and an ImagePath is a command line, so any service anywhere can carry a secret
  there. `systeminsights/managed_policies` is narrower still — every macOS managed preference arrives under the
  same two columns, so `value` can be a screen-lock timeout on one row and a secret on the next, and only the
  sibling `name` separates them. So the kit's `AtlasFieldDenial` sees the containing record,
  `jumpcloud/sensitiveFields.ts` names the endpoint and optionally the sibling, and the ordinary policy values
  publish while the credential-bearing siblings are withheld. A missing sibling does NOT withhold, so a record shape that changed
  reaches the gate and refuses rather than being dropped quietly.
- **No atlas is refreshed automatically.** Each is as current as the last `sync`; check before leaning on
  one for a "does this exist" answer.
