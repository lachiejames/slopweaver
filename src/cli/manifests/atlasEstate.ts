/**
 * The `atlas` rows that address the ESTATE rather than a platform.
 *
 * ## Why these rows left `atlas.ts`
 *
 * That file grows by one row per atlas with no ceiling and crossed the 600-code-line `file-size-ratchet`
 * cap again when `freshness` landed. `atlasSlack.ts` is the earlier cut, on
 * a property its rows share; this is the same move on the sharpest property left.
 *
 * `backlog`, `doctor`, `freshness` and `probe` are the only rows here that take no platform at all by
 * default. Every other row in `atlas.ts` IS a platform — its verbs, its credential, its surfaces — while
 * these four sweep whatever the estate holds and ask one question of each: what is still owed, can it be
 * read back, is it inside its window, and does it carry this question's words. They are also the rows a
 * scheduled tick, a pull request run and a detective wave run rather than a person reading one atlas, which
 * is why they belong together rather than beside the platform they happen to sort next to.
 *
 * `backlog` is the odd one on exit codes and deliberately so: it always exits 0, because the owner ruled its
 * subject a backlog rather than a gate. See `atlas/kit/backlog.ts`.
 *
 * `probe` is the odd one on where it READS: the other three open each atlas's own descriptor or generation
 * off disk, and it reads the five atlas tables in the store instead, which is what lets it ask all 35
 * platforms one question in one statement. `src/store/atlas/probe.ts` carries the measurement and the
 * reason the ruling that an atlas is distinct from the corpus survives it untouched.
 */

import { ATLAS_BACKLOG_USAGE } from "../commands/atlas/backlogUsage.js";
import { ATLAS_PROBE_USAGE } from "../commands/atlas/probeUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const atlasEstateManifest: Readonly<Record<string, VerbManifestEntry>> = {
  backlog: lazy({
    load: () => import("../commands/atlas/backlogRun.js").then((m) => m.atlasBacklogCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // One descriptor read per atlas. No network call, no credential, no generation opened.
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver atlas backlog --named-only",
      parseRejectIsIoFree: true,
      summary:
        "The refused-exclusion backlog across every atlas, in the order the owner ruled it should be " +
        "worked: the nine named atlases first, then the rest densest-first, each " +
        "row carrying what would close it. ALWAYS exits 0 — these are a backlog to " +
        "chug through, never a gate on an atlas pull request; `atlas <platform> coverage` is the gate",
      usage: ATLAS_BACKLOG_USAGE,
    },
  }),
  doctor: lazy({
    load: () => import("../commands/atlas/doctorRun.js").then((m) => m.atlasDoctorCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // Reads local generations only, through the same guarded path a reader gets. No network call.
      doorRouted: false,
      dryParseSafe: true,
      // `--repair` rewrites a legacy on-disk layout in place, so this row is local-state rather than none.
      effect: "local-state",
      example: "slopweaver atlas doctor --json",
      parseRejectIsIoFree: true,
      summary:
        "Grade every atlas this build has on whether it can actually ANSWER — the definition-of-done check " +
        "an atlas pull request owes, with no bot and no credential. An atlas whose manifest vouches for a " +
        "generation the reader cannot read back is DARK and fails the run; `--repair` rewrites one still " +
        "in the pre-`.jsonl` on-disk layout, archiving the old documents rather than discarding them",
      usage:
        "usage: slopweaver atlas doctor [<platform>] [--repair] [--json] [--home <dir>]\n" +
        "  <platform>   grade one atlas; omitted grades every atlas this build has\n" +
        "  --repair     rewrite any generation still in the pre-`.jsonl` on-disk layout\n" +
        "  --json       the rows plus the verdict, for a gate to read\n" +
        "  --home       the state home to grade, instead of $SLOPWEAVER_HOME",
    },
  }),
  freshness: lazy({
    load: () => import("../commands/atlas/freshnessRun.js").then((m) => m.atlasFreshnessCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // One manifest read and one live-read stamp per atlas. No network call and no credential.
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver atlas freshness --behind-only",
      parseRejectIsIoFree: true,
      summary:
        "Judge every atlas against its own rolling freshness window — four hours by default, per atlas by " +
        "declaration — and say which are behind, whether a bounded live read answers them, and which need " +
        "a whole resync. The atlas half of the same window `refresh --if-stale` applies to the corpus; " +
        "exits non-zero when anything is behind, so a scheduled row can act on it",
      usage:
        "usage: slopweaver atlas freshness [<platform>] [--behind-only] [--window <duration>] [--json]\n" +
        "       [--home <dir>]\n" +
        "  <platform>      judge one atlas; omitted judges every atlas this build has\n" +
        "  --behind-only   print only the atlases past their window\n" +
        "  --window        judge every atlas against this window instead of its own — `30m`, `4h`, `7d`\n" +
        "  --json          the verdicts plus the counts, for a scheduled row to read\n" +
        "  --home          the state home to judge, instead of $SLOPWEAVER_HOME",
    },
  }),
  probe: lazy({
    load: () => import("../commands/atlas/probeRun.js").then((m) => m.atlasProbeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // Five indexed tables in the store. No network call, no credential, no generation file opened.
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver atlas probe airtable sync --json",
      parseRejectIsIoFree: true,
      summary:
        "Count a question's keywords across EVERY atlas at once — the rung a detective climbs before it " +
        "opens one. Two rungs over the atlas tables in the store: the platform's own handle for a thing " +
        "(`provider_id`, the kind name) and what a channel learned about it (`detail`), counted per " +
        "(platform, kind) with each cell's last successful sync beside it. A count is of STORED records " +
        "and proves nothing about a provider: `atlas <platform> read` is what carries the claim boundary",
      usage: ATLAS_PROBE_USAGE,
    },
  }),
};
