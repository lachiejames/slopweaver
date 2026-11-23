/**
 * Whether a surface is FILLED is read off the store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent, measured twice
 *
 * A descriptor's `status` is a static string. Left that way it is filled on every install, including one
 * where the sync has never run — and the sibling atlases prove the failure is not hypothetical. The Slack
 * atlas grades its browser surface synced whenever pages-walked exceeds zero, while canon records it
 * reached only a fraction of the destinations it asked for. The CrowdStrike walk graded its declared console
 * routes green, every one screenshotted and classified, while the routes had in fact redirected to a landing
 * page or answered 404. Counting attempts is not reading content.
 *
 * So the flip is computed here, from what the manifest actually records, against an exact invariant:
 * **every applicable kind must be accounted for** — a recorded success, or a whole-kind permission boundary
 * or product absence the sync stamped from typed failures (`kindAccountedFor`). Not "most", not "at least one" — the kit's own
 * success predicate is already existential, and inheriting that here would make `filled` mean "something
 * worked once".
 *
 * ## What "applicable" excludes, and why that is not a loophole
 *
 * The two shape-indexed event families are not walked at all, by ruling, so requiring a success for them
 * would make the API surface permanently unfillable for a reason that has nothing to do with the API. They
 * are excluded from the denominator and say so in their own coverage cells — which is the difference
 * between a stated exclusion and a silent one.
 *
 * ## The console surface is filled by the LATEST walk holding every declared page
 *
 * `admin-console` reads the console generation (`consoleModel.ts`): it is `filled` exactly when every page
 * `browserPages.ts` declares is HELD on the most recent walk — reached where it was asked, photographed, and
 * the picture still referenced — and `declared-unfilled` naming the shortfall otherwise. "Most recent" is the
 * manifest's own last page attempt, and a page counts only when its view was stamped at that instant: an
 * entity a previous walk reached and this one did not is carried stale, never credited. A walk that held
 * every declared page but one is unfilled, for the same reason one API kind short is.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { JUMPCLOUD_CONSOLE_PAGES } from "./browserPages.js";
import {
  type JumpcloudConsoleEntity,
  type JumpcloudConsoleKindFile,
  type JumpcloudConsoleManifest,
  jumpcloudConsolePageDetailSchema,
} from "./consoleModel.js";
import { JUMPCLOUD_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { JumpcloudManifest } from "./entities.js";
import { JUMPCLOUD_KINDS, type JumpcloudKind } from "./model.js";
import { isShapeIndexedKind } from "./plan.js";

/** How many outstanding names an unfilled reason lists before it elides the rest. */
const OUTSTANDING_SHOWN = 8;

/**
 * Every kind the Directory API surface is answerable for — the denominator of the fill check.
 *
 * @returns the declared kinds minus the two that are indexed by shape rather than walked
 */
export function applicableApiKinds(): readonly JumpcloudKind[] {
  return JUMPCLOUD_KINDS.filter((kind) => !isShapeIndexedKind({ kind }));
}

/**
 * What the store says about the Directory API surface.
 * @internal
 */
export interface JumpcloudApiFill {
  readonly filled: boolean;
  /** Applicable kinds accounted for — see `kindAccountedFor`. */
  readonly succeeded: number;
  /** Applicable kinds in total. */
  readonly applicable: number;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/**
 * Whether the store says one kind holds everything this credential can be served.
 *
 * A recorded success, which includes a kind whose only failures were the provider's own answers
 * (`kindBoundary.ts`'s `providerAnswers`); or a whole-kind permission boundary; or a whole-kind product
 * absence. The last two are counted because an atlas owes all reachable information the credential's
 * permissions allow and, for a product the organisation does not have, it is valid to exclude it. Each is a stamp a sync writes only from typed failures, never a default.
 *
 * @param status the kind's manifest status
 * @returns whether the kind is accounted for
 */
function kindAccountedFor({ status }: { status: JumpcloudManifest["kinds"][JumpcloudKind] }): boolean {
  return status.lastSuccessAt !== null || status.permissionBlocked != null || status.productAbsent != null;
}

/**
 * Judge the Directory API surface from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether the surface is filled, and the numbers behind the verdict
 */
export function jumpcloudApiFill({ manifest }: { manifest: JumpcloudManifest | null }): JumpcloudApiFill {
  const applicable = applicableApiKinds();
  const outstanding = applicable
    .filter((kind) => manifest === null || !kindAccountedFor({ status: manifest.kinds[kind] }))
    .toSorted();
  return {
    applicable: applicable.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: applicable.length - outstanding.length,
  };
}

/**
 * What the console store holds, as the fill check reads it.
 *
 * `unreadableBecause` is set when the console generation could not be read at all, which is a different
 * report from one that was read and falls short — the surface says which.
 *
 * @internal
 */
export interface JumpcloudConsoleEvidence {
  readonly manifest: JumpcloudConsoleManifest | null;
  readonly pageFile: JumpcloudConsoleKindFile | null;
  readonly unreadableBecause: string | null;
}

/**
 * What the store says about the administrator console surface.
 * @internal
 */
export interface JumpcloudConsoleFill {
  readonly filled: boolean;
  /** Declared pages the latest walk reached AND photographed. */
  readonly held: number;
  /** Declared pages the latest walk asked for at all. */
  readonly requested: number;
  /** Declared pages in total — the denominator. */
  readonly declared: number;
  /** Declared pages not held, in declaration order — what a reader chases. */
  readonly outstanding: readonly string[];
  /** The latest walk's instant, or `null` when none has been recorded. */
  readonly walkedAt: string | null;
}

/** Whether one stored page entity was asked for on the walk stamped `walkedAt`. */
function requestedOnWalk({ entity, walkedAt }: { entity: JumpcloudConsoleEntity; walkedAt: string }): boolean {
  const view = entity.channels["admin-console"];
  return view?.state === "observed" && view.lastSeenAt === walkedAt;
}

/** Whether one stored page entity is HELD on the walk stamped `walkedAt`: reached, and its picture referenced. */
function heldOnWalk({ entity, walkedAt }: { entity: JumpcloudConsoleEntity; walkedAt: string }): boolean {
  const view = entity.channels["admin-console"];
  if (view?.source == null || !requestedOnWalk({ entity, walkedAt })) {
    return false;
  }
  const detail = jumpcloudConsolePageDetailSchema.safeParse(view.detail);
  if (!detail.success) {
    return false;
  }
  return (
    detail.data.unreachableBecause === null &&
    detail.data.screenshotMissingBecause === null &&
    view.source.artifacts.length > 0
  );
}

/**
 * Judge the administrator console surface from the console generation alone.
 *
 * @param evidence what the console store holds
 * @returns whether the surface is filled, and the numbers behind the verdict
 */
export function jumpcloudConsoleFill({ evidence }: { evidence: JumpcloudConsoleEvidence }): JumpcloudConsoleFill {
  const declared = JUMPCLOUD_CONSOLE_PAGES.map((page) => page.surface);
  const lastAttempt = evidence.manifest === null ? null : evidence.manifest.kinds.page.lastAttempt;
  if (lastAttempt === null || evidence.pageFile === null) {
    return { declared: declared.length, filled: false, held: 0, outstanding: declared, requested: 0, walkedAt: null };
  }
  const walkedAt = lastAttempt.at;
  const bySurface = new Map(evidence.pageFile.entities.map((entity) => [entity.providerId, entity]));
  const held = declared.filter((surface) => {
    const entity = bySurface.get(surface);
    return entity !== undefined && heldOnWalk({ entity, walkedAt });
  });
  const requested = declared.filter((surface) => {
    const entity = bySurface.get(surface);
    return entity !== undefined && requestedOnWalk({ entity, walkedAt });
  });
  const heldSet = new Set(held);
  return {
    declared: declared.length,
    filled: held.length === declared.length && requested.length === declared.length,
    held: held.length,
    outstanding: declared.filter((surface) => !heldSet.has(surface)),
    requested: requested.length,
    walkedAt,
  };
}

/** A list of names, cut to {@link OUTSTANDING_SHOWN} with an ellipsis when longer. */
function shortList({ names }: { names: readonly string[] }): string {
  const more = names.length > OUTSTANDING_SHOWN ? ", …" : "";
  return `${names.slice(0, OUTSTANDING_SHOWN).join(", ")}${more}`;
}

/** Why the console surface is unfilled, in the words a reader acts on. */
function consoleUnfilledBecause({
  evidence,
  fill,
}: {
  evidence: JumpcloudConsoleEvidence;
  fill: JumpcloudConsoleFill;
}): string {
  if (evidence.unreadableBecause !== null) {
    return `the console generation could not be read: ${evidence.unreadableBecause}`;
  }
  if (fill.walkedAt === null) {
    return "no console walk has been recorded on this install. Run: slopweaver atlas jumpcloud walk";
  }
  return (
    `the latest walk (${fill.walkedAt}) held ${String(fill.held)} of ${String(fill.declared)} declared page(s), ` +
    `reached and photographed; still outstanding: ${shortList({ names: fill.outstanding })}. ` +
    `Run: slopweaver atlas jumpcloud walk`
  );
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published API manifest, or `null` when nothing has been published
 * @param console what the console store holds
 * @returns the descriptor with every surface's status derived rather than declared
 */
export function jumpcloudDescriptorFor({
  manifest,
  console: evidence,
}: {
  manifest: JumpcloudManifest | null;
  console: JumpcloudConsoleEvidence;
}): AtlasDescriptor {
  const fill = jumpcloudApiFill({ manifest });
  const consoleFill = jumpcloudConsoleFill({ evidence });
  return {
    ...JUMPCLOUD_ATLAS_DESCRIPTOR,
    surfaces: JUMPCLOUD_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.acquisition !== "api") {
        if (consoleFill.filled && evidence.unreadableBecause === null) {
          return { ...surface, status: "filled" as const, unfilledBecause: null };
        }
        return {
          ...surface,
          status: "declared-unfilled" as const,
          unfilledBecause: consoleUnfilledBecause({ evidence, fill: consoleFill }),
        };
      }
      if (fill.filled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      return {
        ...surface,
        status: "declared-unfilled" as const,
        unfilledBecause: `${String(fill.succeeded)} of ${String(fill.applicable)} applicable kinds are accounted for; still outstanding: ${shortList({ names: fill.outstanding })}. Run: slopweaver atlas jumpcloud sync`,
      };
    }),
  };
}
