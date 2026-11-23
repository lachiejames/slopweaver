# Each destination's record: status, strands and the sweep

Part of [the backup](backup.md).

**`store backup --status` is green only when the last attempt wrote to a destination and failed at none**, so
`store backup --status || <alert>` is the check. That is a narrower statement than it sounds, and the
narrowness is the point: `last.json` is ONE file that every invocation overwrites, so a hand-typed
`store backup --local-only` replaces the nightly's record with its own. A record reading
`{"status":"succeeded","uploaded":false}` that exits zero is the shape of a backup nobody notices is not
happening — MEASURED on this install, where `2026-09-20T05-49-58-043Z` and `2026-09-20T14-24-14-429Z` held
1.98 GB of dump that never left the machine behind a green status. So a run that sent nothing records a
`staged` arm naming WHY it sent nothing, no shape calls an unuploaded run a success, and `--status` also
reports, **per destination, when bytes last reached it** — derived from the newest staging that still holds
that destination's receipt, which the pruner keeps by construction. So an unplugged SSD reads
`FixtureDrive (/Volumes/FixtureDrive/backups) last written <instant>` beside this Mac's own line, and a red
after a deliberate `--local-only` is still actionable.

The cases, and the exit code each earns. A `destinations` record carries one attempt per destination
(`succeeded` with its prefix, `drive-not-plugged-in` with its mount point and volume, or `failed` with every
reason) and exits `0` when at least one destination was written and none failed — this Mac written with the SSD
out is green, every drive out is red. `staged` names the directory and why nothing was sent → `1`; `failed`
before anything was staged prints every reason → `1`; a `last.json` that is present and is NOT a last-attempt
record says so rather than reading as "never run" → `1`. Only a genuinely absent file is green, because a fresh
install has nothing to alert about. A `last.json` naming one destination in its own field reads as a
one-destination record.

**A writing run NAMES, per destination, any earlier staging that destination never got, and writes none of
it.** A staging carrying `files.json` — the last file a run writes into one before it sends, which is what makes
the test safe against a run in flight — that owes a destination (its `destinations.json`) and holds no receipt
for it is stranded for that destination, and the run prints one line per destination listing them. It does not
send them because a strand is a recovery, and a recovery inside the nightly budget is what made the nightly miss
it: a stranded version-1 staging carries its whole dump, 0.9–1.5 GB each on this install, against the recipe's
1,700-second budget.

**The files leg is frozen once a night, into the staging's `snapshot/`, and kept until every destination the
staging owes holds it**, so a sweep sends an SSD the same bytes this Mac got rather than re-reading files that
have changed since. The snapshot is released, and the staging becomes prunable, only once every owed
destination's receipt parses; a missing or truncated one keeps everything.

**`store backup --sweep-only` sends those stagings and takes no new dump** — how a night a destination missed
is sent later without dumping again. Each destination is swept on its own, through its own door as the same
`external-write`: each staging goes under its own prefix, gets that destination's receipt, and is released to
the pruner once every destination it owes holds it, so the 1.98 GB above is reclaimed rather than held forever;
the NEWEST goes first, because it is the more valuable copy. A staged dump, tar or bundle earns the receipt only
when what was sent hashes to the digest its `manifest.json` recorded, so a file altered on disk at the same
length is refused rather than sent under that night's name. A staging this build wrote sends its dump as
chunks; an older one sends it whole, exactly as it was written to be. The sweep prunes as a full run does and
leaves `last.json` as the night wrote it, because that record is the night's: what a sweep landed reads off the
receipts, and `--status`'s `last written` line moves the moment a sweep sends a destination its staging, while
the night's `DRIVE NOT PLUGGED IN` beneath it says a sweep has since sent that night instead of asking for one. A
staging that would not go still prints and exits non-zero; with every drive out the sweep sends nothing, reads
no key and exits 0. Under the hourly row that non-zero exit fails the firing once, and the scheduler's failure
policy then holds the row behind a finding, so later nights are not swept until that staging is fixed or
deleted and the hold lifts as any failure hold does (`src/live/automation/failureHold.ts` names how).

Two limits, stated rather than discovered. A staging from before the snapshot was kept has no frozen copies, so
the sweep sends its own objects and its dump's chunks and NOT the content-addressed blobs or file chunks its
`files.json` names — those live under `$SLOPWEAVER_HOME` at paths whose contents may have changed since, so
re-reading one would not hash to the name that night's manifest gave it. So before such a staging's receipt —
after which the pruner may let it go — the sweep lists what its `files.json` names against the destination
(`src/store/backup/filesHeld.ts`), and its report line says how many are missing and that its files half will
not restore, while its dump does. And a staging whose `manifest.json` this schema refuses is reported as
unrecoverable rather than sent; it is not restorable either, because `store restore --from <dir>` reads it
through the same `parseBackupManifest`, and the report says so — the real case is `2026-09-20T05-49-58-043Z`,
whose manifest predates the credentials leg and carries no `secrets` key at all.
