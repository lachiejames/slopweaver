/**
 * Turning what the ATLAS tables hold into leads a wave can spend a detective on. Pure.
 *
 * ## Why the atlases are in the fan-out at all
 *
 * The atlases are the best data sources the install has, so withholding them from the detectives would be
 * wrong: the atlases must be accessible by the detectives. Anything the owner can reach by speaking to the
 * supervisor is also reachable via the bot entry point.
 *
 * The counting is `src/store/atlas/probe.ts` — read its header for the two rungs, the measurement, and the
 * reason the "an atlas is distinct from the corpus" ruling survives this untouched. What is here is
 * the one decision the probe deliberately does not make: which platform is worth a detective.
 *
 * ## One lead per PLATFORM, never one per cell
 *
 * The identical rule `./datadogLead.ts` states for a service and `./fanout.ts` states for the store's
 * seven shapes, and here it has teeth: MEASURED, about three quarters of the atlas entity rows
 * in this store are jumpcloud, so a lead per `(platform, kind)` cell spends every atlas slot on jumpcloud's
 * kinds and never opens the handful of github rows or the hundreds of hex ones. The platform is also the unit a detective
 * can actually be SENT to — `slopweaver atlas <platform> read` — so it is the unit a lead addresses.
 *
 * ## And ONE source, so the atlas cannot monopolise the wave either
 *
 * Every atlas lead carries `source: "atlas"`, so `./fanout.ts`'s round-robin hands the whole estate one
 * slot per round exactly as it hands Slack one. Giving each platform its own source name was considered
 * and rejected: with a few dozen platforms it would put up to a few dozen leads into round one ahead of a single Slack lead,
 * which is the anti-monopoly rule defeated by the thing it was written to prevent.
 *
 * ## The weight is nominal even though the count is real, and that is deliberate
 *
 * `./datadogLead.ts` and `./hexLead.ts` carry nominal weights because counting would cost them a live
 * read. This gate CAN count — a couple of seconds for the whole statement — and it does, and the real
 * numbers are printed by `slopweaver atlas probe` and carried in every lead's `why`.
 *
 * But `Lead.rows` is not a report field, it is the ORDERING field, and `hexLead.ts` already records why
 * that matters: the gates' weights are compared against each other by `planWave`, _"so a Hex project hit
 * and a Datadog service hit have to be denominated the same way or one source silently outranks the other
 * on arithmetic nobody chose"_. A cell of hundreds of thousands of entities in `Lead.rows` would make the atlas outrank
 * every other source on every question forever. So the weight is denominated exactly as its two siblings
 * are — strongest hit KIND dominating, the count only breaking ties — and the counts live in the prose a
 * reader actually reads.
 */
import { MIN_KEYWORD_CHARS } from "../datadog/detective/gate.js";
import { type AtlasProbeCell, type AtlasProbeReport, type AtlasProbeRow, foldPlatforms } from "../store/atlas/probe.js";

import type { Lead } from "./fanout.js";

/**
 * The `source` every atlas lead carries, so a brief and a report can tell it from a store, Datadog or Hex
 * lead.
 *
 * @internal
 */
export const ATLAS_LEAD_SOURCE = "atlas";

/**
 * How much one rank of hit kind is worth, in the nominal units {@link atlasLeadWeight} counts in.
 *
 * Matched to `./datadogLead.ts` and `./hexLead.ts`'s own constant deliberately — see this module's header
 * on why all three gates have to be denominated the same way.
 */
const KIND_WEIGHT = 1000;

/**
 * What kind of thing in the atlas a keyword hit, weakest last.
 *
 * `platform-name` leads because a question naming a platform is asking about that platform, and because it
 * is the ONLY way an atlas whose entities are compiled API operations gets reached at all — MEASURED,
 * the keyword `airtable` matches zero `provider_id`s in the airtable atlas's hundred-odd entities and
 * matches its platform name exactly.
 *
 * `detail` is last because it is the provider's own opaque JSON: the same measurement found `password`
 * inside well over a thousand jumpcloud application templates, which is a true fact about a bag of vendor metadata rather
 * than a lead about this organisation's password posture.
 *
 * @internal
 */
export const ATLAS_HIT_KINDS = ["platform-name", "kind-name", "provider-id", "detail"] as const;

/** One hit kind's id. */
export type AtlasHitKind = (typeof ATLAS_HIT_KINDS)[number];

/**
 * How much one platform's accumulated hits are worth, dominated by the strongest kind.
 *
 * @param hits how many `(platform, kind)` cells the keyword reached on this platform
 * @param kinds every kind of thing it matched
 * @returns the nominal weight
 */
export function atlasLeadWeight({ hits, kinds }: { hits: number; kinds: ReadonlySet<AtlasHitKind> }): number {
  const strongest = Math.min(...[...kinds].map((kind) => ATLAS_HIT_KINDS.indexOf(kind)));
  return (ATLAS_HIT_KINDS.length - strongest) * KIND_WEIGHT + hits;
}

/** What one platform accumulated across every keyword that reached it. */
interface PlatformBucket {
  readonly keywords: Set<string>;
  readonly kinds: Set<AtlasHitKind>;
  /** The widest cell seen on this platform across every keyword — where its detective opens. */
  widest: AtlasProbeCell | null;
  entities: number;
  cells: number;
}

/** A fresh, empty bucket. */
function emptyBucket(): PlatformBucket {
  return { cells: 0, entities: 0, keywords: new Set<string>(), kinds: new Set<AtlasHitKind>(), widest: null };
}

/**
 * The bucket one platform accumulates into, minting it on first sight.
 *
 * @param byPlatform the buckets so far
 * @param platform the platform being placed
 * @returns its bucket
 */
function bucketFor({
  byPlatform,
  platform,
}: {
  byPlatform: Map<string, PlatformBucket>;
  platform: string;
}): PlatformBucket {
  const held = byPlatform.get(platform);
  if (held === undefined) {
    const fresh = emptyBucket();
    byPlatform.set(platform, fresh);
    return fresh;
  }
  return held;
}

/**
 * Which hit kinds one cell represents.
 *
 * A cell's `byName` count folds two distinguishable things — the kind's own name and the platform's handle
 * for an entity — and the cell cannot tell them apart, so the stronger of the two is claimed only when the
 * keyword really is inside the kind name. Everything else on the name rung is a `provider-id`.
 *
 * @param cell one `(platform, kind)` cell
 * @param keyword the keyword that produced it
 * @returns the kinds it contributes
 */
function cellKinds({ cell, keyword }: { cell: AtlasProbeCell; keyword: string }): readonly AtlasHitKind[] {
  const named = cell.kind.toLowerCase().includes(keyword.toLowerCase());
  const nameKinds: readonly AtlasHitKind[] = cell.byName === 0 ? [] : [named ? "kind-name" : "provider-id"];
  const detailKinds: readonly AtlasHitKind[] = cell.byDetail === 0 ? [] : ["detail"];
  return [...nameKinds, ...detailKinds];
}

/**
 * Accumulate one keyword's whole row onto the per-platform buckets.
 *
 * @param row one keyword's cells and platform-name matches
 * @param byPlatform the buckets, extended in place
 */
function takeRow({ row, byPlatform }: { row: AtlasProbeRow; byPlatform: Map<string, PlatformBucket> }): void {
  for (const platform of row.platformNames) {
    const bucket = bucketFor({ byPlatform, platform });
    bucket.keywords.add(row.subject);
    bucket.kinds.add("platform-name");
  }
  for (const found of foldPlatforms({ row })) {
    const bucket = bucketFor({ byPlatform, platform: found.platform });
    bucket.keywords.add(row.subject);
    bucket.entities += found.entities;
    bucket.cells += found.kinds;
    if (bucket.widest === null || found.widest.entities > bucket.widest.entities) {
      bucket.widest = found.widest;
    }
    for (const cell of row.cells.filter((each) => each.platform === found.platform)) {
      for (const kind of cellKinds({ cell, keyword: row.subject })) {
        bucket.kinds.add(kind);
      }
    }
  }
}

/**
 * The staleness clause a lead carries about the kind it opens on, or nothing when there is nothing to say.
 *
 * `skills/atlas/SKILL.md`: _"Stale is a reason to resync, not a reason to hedge"_ — which only works if
 * the number reaches the reader before the reading does.
 *
 * @param widest the cell the detective opens on, or nothing when the platform matched by name alone
 * @returns the clause, or an empty string
 */
function freshnessClause({ widest }: { widest: AtlasProbeCell | null }): string {
  if (widest === null) {
    return "";
  }
  const synced =
    widest.lastSuccessAtIso === null
      ? "that kind has NEVER synced successfully"
      : `last synced ${widest.lastSuccessAtIso}`;
  if (widest.lastAttemptOutcome === null || widest.lastAttemptOutcome === "ok") {
    return ` — ${synced}`;
  }
  return ` — ${synced}, latest attempt ${widest.lastAttemptOutcome}`;
}

/**
 * The sentence one platform's lead carries into the brief and the wave report.
 *
 * @param platform the platform
 * @param bucket what it accumulated
 * @returns the `why`
 */
function leadWhy({ platform, bucket }: { platform: string; bucket: PlatformBucket }): string {
  const words = [...bucket.keywords]
    .toSorted()
    .map((word) => `"${word}"`)
    .join(", ");
  if (bucket.widest === null) {
    return `the question names the ${platform} atlas itself (${words}) — nothing in its stored rows matched, so start from what it declares it holds`;
  }
  return (
    `the ${platform} atlas holds ${String(bucket.entities)} stored record(s) matching ${words} across ` +
    `${String(bucket.cells)} kind(s), widest ${bucket.widest.kind} at ${String(bucket.widest.entities)}` +
    freshnessClause({ widest: bucket.widest })
  );
}

/**
 * Turn one atlas probe report into the leads a wave can spend detectives on.
 *
 * A keyword shorter than {@link MIN_KEYWORD_CHARS} is dropped before it reaches the probe by the caller;
 * this applies the same floor again over the report's own subjects, so a report assembled by hand in a
 * test cannot smuggle a two-letter keyword past it.
 *
 * @param report what the probe counted
 * @returns one lead per platform, strongest first
 */
export function atlasLeads({ report }: { report: AtlasProbeReport }): readonly Lead[] {
  const byPlatform = new Map<string, PlatformBucket>();
  for (const row of report.rows.filter((each) => each.subject.trim().length >= MIN_KEYWORD_CHARS)) {
    takeRow({ byPlatform, row });
  }
  return (
    [...byPlatform.entries()]
      .map(([platform, bucket]): Lead => {
        return {
          // A bucket is only minted when a keyword reached its platform, so it always carries at least one
          // — an honest assertion rather than a coalesce inventing a lead with no keyword in it.
          keyword: [...bucket.keywords].toSorted()[0]!,
          rows: atlasLeadWeight({ hits: bucket.cells, kinds: bucket.kinds }),
          source: ATLAS_LEAD_SOURCE,
          startShape: platform,
          why: leadWhy({ bucket, platform }),
        };
      })
      // Ties break on the platform so two runs of one probe order identically. `startShape` is never null
      // on an atlas lead — every one of them addresses a platform, and the map above is where it is set — so
      // the assertions are honest rather than a coalesce inventing an empty platform that could never be one.
      .toSorted((left, right) => right.rows - left.rows || left.startShape!.localeCompare(right.startShape!))
  );
}
