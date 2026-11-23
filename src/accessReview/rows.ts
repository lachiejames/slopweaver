/**
 * Turning one atlas's stored entities into access-review ROWS — and counting, out loud, everything the
 * projection could not use.
 *
 * ## Nothing is dropped silently, and that is the whole design
 *
 * `atlas/kit/read.ts` says a read must never err in the direction of understating coverage. A report that
 * quietly skipped a record whose address it could not find would under-report access, which on this subject
 * means reporting a former employee as clean because the code could not read their email. So every record of
 * the right family that yields no address is COUNTED, and the count is printed beside the rows rather than
 * kept for a debug flag.
 *
 * Three further counts earn their place for the same reason:
 *
 * - **Records a complete read no longer returned** (`stale`), which the projection SKIPS: the atlas keeps a
 *   deleted account's last detail, so its `state` still reads live. Counted, so a reader sees how many
 *   deleted accounts the store still carries rather than meeting them as violations. A record goes stale
 *   only when a COMPLETE read no longer returned it (`atlas/kit/merge.ts`). MEASURED over one
 *   day's atlas generations with `slopweaver access-review former`: before this skip a stale record alone
 *   was enough to print a CONFIRMED row, and after it a stale record prints none.
 * - **Records of another declared surface family**, which is the ordinary case on a kind that mixes them —
 *   on JumpCloud's `systemusers`, a list projection and a TOTP fact sit beside each person's own record.
 *   Printing how many records belong to another family is what lets a reader see why the person count is
 *   right while sitting well below the record count.
 * - **Two records carrying one address**, which the join cannot resolve and which nothing else would notice.
 *   The last one read wins so the report is total, except that a live record is never displaced by a dead
 *   one, and the collision is reported.
 */
import type { AtlasEntityView } from "../atlas/kit/read.js";
import { entityIsCurrent } from "../atlas/kit/selectEntities.js";

import {
  type AccessLevelValue,
  type AccessPlatformSpec,
  holdsAccount,
  levelValuesOf,
  readDetailPath,
  verbatimLevel,
} from "./levels.js";

/** One person's row on one platform. */
export interface AccessRow {
  /** The address, lowercased and trimmed — the join key, and never displayed. */
  readonly email: string;
  /** The address exactly as the platform stored it, which is what an auditor searches for. */
  readonly emailVerbatim: string;
  /** The platform's own display name, or `null` when it stores none. */
  readonly display: string | null;
  /** Every declared level, verbatim, in the spec's order. */
  readonly levels: readonly AccessLevelValue[];
  /** Whether this row means the person still holds an account here. */
  readonly holds: boolean;
  /** The atlas entity this came from, so a row can be traced back to a record. */
  readonly providerId: string;
}

/** Every row one platform contributed, and everything the projection could not use. */
export interface AccessPlatformRows {
  readonly platform: string;
  readonly kind: string;
  readonly rows: readonly AccessRow[];
  /** Records of the right family whose detail carried no readable address. */
  readonly addressless: number;
  /** Records the kind holds that belong to another declared surface family. */
  readonly otherFamily: number;
  /** Records of the right family a COMPLETE read no longer returned — gone at the provider, not live. */
  readonly stale: number;
  /** Addresses two or more records of the right family both claimed, sorted. */
  readonly collidingAddresses: readonly string[];
}

/**
 * Whether one entity belongs to the surface family a spec names.
 *
 * @returns `true` for every entity when the spec declares no family, else whether the provider id opens with it
 */
export function inFamily({ entity, spec }: { entity: AtlasEntityView; spec: AccessPlatformSpec }): boolean {
  if (spec.surfaceFamily === null) {
    return true;
  }
  return entity.providerId.startsWith(`${spec.surfaceFamily}:`);
}

/** The lowercased join key one entity yields, or `null` when it carries no usable address. */
function addressOf({ entity, spec }: { entity: AtlasEntityView; spec: AccessPlatformSpec }): string | null {
  const raw = verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: spec.emailPath }) });
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

/**
 * Project one atlas kind's entities into access-review rows.
 *
 * @param spec the platform whose fields to read
 * @param entities the kind's entities, exactly as the snapshot presented them
 * @returns the rows, keyed by lowercased address, plus every count the projection owes a reader
 */
export function accessRowsOf({
  spec,
  entities,
}: {
  spec: AccessPlatformSpec;
  entities: readonly AtlasEntityView[];
}): AccessPlatformRows {
  const byAddress = new Map<string, AccessRow>();
  const collisions = new Set<string>();
  let addressless = 0;
  let otherFamily = 0;
  let stale = 0;
  for (const entity of entities) {
    if (!inFamily({ entity, spec })) {
      otherFamily += 1;
      continue;
    }
    // Deleted at the provider, so its stored state is not today's — see the file header's `stale` bullet.
    if (!entityIsCurrent({ entity })) {
      stale += 1;
      continue;
    }
    const verbatim = addressOf({ entity, spec });
    if (verbatim === null) {
      addressless += 1;
      continue;
    }
    const email = verbatim.toLowerCase();
    const earlier = byAddress.get(email);
    if (earlier !== undefined) {
      collisions.add(email);
    }
    const levels = levelValuesOf({ detail: entity.detail, spec });
    const holds = holdsAccount({ levels, spec });
    // A live record is never overwritten by a dead one sharing its address: the join reads one row per
    // address, and a later suspended duplicate would otherwise hide a live account and let it read clean.
    if (earlier !== undefined && earlier.holds && !holds) {
      continue;
    }
    byAddress.set(email, {
      display: verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: spec.displayPath }) }),
      email,
      emailVerbatim: verbatim,
      holds,
      levels,
      providerId: entity.providerId,
    });
  }
  return {
    addressless,
    collidingAddresses: [...collisions].toSorted(),
    kind: spec.kind,
    otherFamily,
    platform: spec.platform,
    rows: [...byAddress.values()].toSorted((left, right) => left.email.localeCompare(right.email)),
    stale,
  };
}
