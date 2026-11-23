/**
 * Publish what a control shot photographed: the control's own page row, and the control itself.
 *
 * ## Two kinds, and neither may truncate the other
 *
 * `browserSurface.ts` republishes the whole `browser-page` file from a walk of the declared list, so a
 * shot's control rows have to survive that — they do, because a shot is graded and reported under its own
 * `control-shot` surface and its rows are MERGED into whatever the file already holds rather than
 * replacing it. The reverse holds too: a shot never touches the `browser-walk` coverage cell, so a run that
 * photographed two controls cannot make the twelve declared pages read as covered.
 *
 * The `control` kind is the one place a browser capture reaches outside the two browser kinds, and
 * `merge.ts`'s {@link mergeVantaBrowserChannel} is what makes that safe: a control's `manage-api` detail —
 * every field the sync established — is carried through untouched, and every control this shot did not ask
 * for is neither rewritten nor staled.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasKindStatus } from "../kit/kindStatus.js";
import { withKindStatus } from "../kit/manifestClock.js";
import type { PageWalkResult } from "../kit/pageWalk.js";
import { verifyArtifactsOnDisk } from "../kit/walkPublish.js";

import { vantaControlSurface } from "./browserPages.js";
import type { VantaObservedCall } from "./browserReduction.js";
import type { VantaPageObservation } from "./browserWalk.js";
import {
  pairControlObservations,
  type ResolvedVantaControl,
  shotControlEntity,
  shotPageEntity,
} from "./controlShot.js";
import { failedVantaCoverageCell, previousVantaCoverageCell, succeededVantaCoverageCell } from "./coverage.js";
import { openVantaGap, reconcileVantaGaps } from "./gaps.js";
import { mergeVantaBrowserChannel } from "./merge.js";
import type { VantaKind, VantaKindFile, VantaManifest } from "./model.js";
import {
  publishVantaAtlas,
  readVantaAtlas,
  storedVantaKindFile,
  storedVantaManifest,
  type VantaAtlasPaths,
} from "./store.js";

/**
 * The surface a control shot's coverage is reported under, distinct from the declared walk's own.
 *
 * @internal
 */
export const VANTA_CONTROL_SHOT_SURFACE = "control-shot";

/**
 * What publishing one control shot did.
 *
 * @internal
 */
export interface VantaControlShotOutcome {
  /** How many controls the caller asked for, after unplaceable ids were refused and duplicates collapsed. */
  readonly askedCount: number;
  /** How many of those the atlas now holds a verified picture and a loaded deep link for. */
  readonly heldCount: number;
  /** Each control it does not hold, and why — never a silence. */
  readonly unheld: readonly { readonly providerId: string; readonly because: string }[];
  readonly written: readonly string[];
}

/**
 * The coverage cell a shot writes, graded on the controls it was ASKED for.
 *
 * The denominator is the request rather than every control this atlas holds, and that is deliberate: a
 * shot is a targeted capture, so grading it against every control would report `deferred` forever and say
 * nothing about whether the capture it was asked for worked. The SCOPE names the controls, so a reader can
 * never mistake a cell for a claim about the whole control set.
 */
function shotCoverageCell({
  askedCount,
  heldCount,
  controls,
  stored,
  at,
}: {
  askedCount: number;
  heldCount: number;
  controls: readonly ResolvedVantaControl[];
  stored: VantaKindFile;
  at: string;
}): VantaKindFile["coverage"][number] {
  const scope = `controls ${controls
    .map((one) => one.providerId)
    .toSorted()
    .join(", ")}`;
  const reason = `${String(heldCount)} of ${String(askedCount)} control page(s) reached and photographed`;
  if (heldCount === askedCount && askedCount > 0) {
    return succeededVantaCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason,
      role: "corroborating",
      scope,
      state: "synced",
      surface: VANTA_CONTROL_SHOT_SURFACE,
    });
  }
  return failedVantaCoverageCell({
    channel: "browser",
    previous: previousVantaCoverageCell({ cells: stored.coverage, surface: VANTA_CONTROL_SHOT_SURFACE }),
    reason,
    role: "corroborating",
    scope,
    state: "deferred",
    surface: VANTA_CONTROL_SHOT_SURFACE,
    unblockedBy: null,
  });
}

/**
 * Publish one control shot into the `browser-page` and `control` kinds.
 *
 * @param controls the controls this shot was asked for, already placed against the atlas
 * @param walk what the walk engine observed over their pages
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishVantaControlShot({
  controls,
  walk,
  paths,
  at,
}: {
  controls: readonly ResolvedVantaControl[];
  walk: PageWalkResult<VantaObservedCall>;
  paths: VantaAtlasPaths;
  at: string;
}): Result<VantaControlShotOutcome> {
  const snapshot = readVantaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  // The bytes, never the reference — see `kit/walkPublish.ts`.
  const pages = verifyArtifactsOnDisk({ directory: paths.directory, pages: walk.pages });
  const paired = pairControlObservations({ controls, pages });
  const storedPages = storedVantaKindFile({ at, kind: "browser-page", snapshot: snapshot.value });
  const storedControls = storedVantaKindFile({ at, kind: "control", snapshot: snapshot.value });
  const built = shotKindFiles({ at, controls, paired, pages, storedControls, storedPages });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishVantaAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { "browser-page": built.value.pageFile, control: built.value.controlFile },
    manifest: shotManifest({
      controlCount: built.value.controlFile.entities.length,
      manifest: storedVantaManifest({ at, snapshot: snapshot.value }),
      pageCount: built.value.pageFile.entities.length,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    askedCount: controls.length,
    heldCount: paired.held.length,
    unheld: paired.unheld.map(({ control, because }) => ({ because, providerId: control.providerId })),
    written: published.value,
  });
}

/**
 * Build both files this shot writes: the control pages it photographed, and the controls those pages
 * established an address for.
 *
 * Split from the publisher so the effectful half reads as read, build, write.
 *
 * @param controls the controls this shot was asked for
 * @param paired which of them the walk actually held, and why the rest are not
 * @param pages every observation, verified against the bytes on disk
 * @param storedPages the `browser-page` file as it stands
 * @param storedControls the `control` file as it stands
 * @param at this run's ISO timestamp
 * @returns both files, or why they could not be built
 */
function shotKindFiles({
  controls,
  paired,
  pages,
  storedPages,
  storedControls,
  at,
}: {
  controls: readonly ResolvedVantaControl[];
  paired: ReturnType<typeof pairControlObservations>;
  pages: readonly VantaPageObservation[];
  storedPages: VantaKindFile;
  storedControls: VantaKindFile;
  at: string;
}): Result<{ pageFile: VantaKindFile; controlFile: VantaKindFile }> {
  const mergedPages = mergeVantaBrowserChannel({
    at,
    observed: pages.map((page) => shotPageEntity({ at, page })),
    stored: storedPages.entities,
  });
  if (mergedPages.isErr()) {
    return err(mergedPages.error);
  }
  const mergedControls = mergeVantaBrowserChannel({
    at,
    observed: paired.held.map(({ control, page }) => shotControlEntity({ at, control, page })),
    stored: storedControls.entities,
  });
  if (mergedControls.isErr()) {
    return err(mergedControls.error);
  }
  const gaps = shotGaps({ at, paired, stored: storedPages.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const cell = shotCoverageCell({
    askedCount: controls.length,
    at,
    controls,
    heldCount: paired.held.length,
    stored: storedPages,
  });
  return ok({
    controlFile: { ...storedControls, entities: [...mergedControls.value], updatedAt: at },
    pageFile: {
      ...storedPages,
      // Every other surface's cell is carried forward; only this shot's own is replaced.
      coverage: [...storedPages.coverage.filter((existing) => existing.surface !== VANTA_CONTROL_SHOT_SURFACE), cell],
      entities: [...mergedPages.value],
      gaps: [...gaps.value],
      updatedAt: at,
    },
  });
}

/**
 * A gap per control this shot could not hold, and a recheck closing one it did.
 *
 * @param paired which controls the walk held, and why the rest are not
 * @param stored the gaps the store already holds
 * @param at this run's ISO timestamp
 * @returns the reconciled gap list, or why it could not be reconciled
 */
function shotGaps({
  paired,
  stored,
  at,
}: {
  paired: ReturnType<typeof pairControlObservations>;
  stored: readonly VantaKindFile["gaps"][number][];
  at: string;
}): Result<readonly VantaKindFile["gaps"][number][]> {
  return reconcileVantaGaps({
    at,
    observed: paired.unheld.map(({ control, because }) =>
      openVantaGap({
        at,
        channel: "browser",
        condition: "detail-unreadable",
        kind: "control",
        reason: because,
        scope: vantaControlSurface({ providerId: control.providerId }),
      }),
    ),
    rechecks: paired.held.map(({ control }) => ({
      condition: "detail-unreadable",
      resolved: true,
      scope: vantaControlSurface({ providerId: control.providerId }),
    })),
    runFailed: false,
    stored,
  });
}

/**
 * The manifest with only the two written kinds' ENTITY COUNTS corrected, and every timestamp carried
 * through.
 *
 * Deliberately not advanced. `lastSuccessAt` on the `control` kind means "the Manage API sync of every
 * control succeeded then", and a shot of two controls stamping it would make a week-old sync read as
 * minutes old — the same class of lie as a coverage cell reading `synced` over no screenshots. What a shot
 * did IS recorded, per surface and with its own timestamp, in the `control-shot` coverage cell, which is
 * where a reader asks that question.
 *
 * The manifest's own clock is not set here either: `publishAtlas` derives it from the kind files it
 * vouches for (`kit/manifestClock.ts`), so a second publisher cannot claim a time the kit never derived.
 *
 * @param manifest the manifest as the store already holds it
 * @param pageCount how many entities the `browser-page` file now holds
 * @param controlCount how many entities the `control` file now holds
 * @returns the manifest to publish
 */
function shotManifest({
  manifest,
  pageCount,
  controlCount,
}: {
  manifest: VantaManifest;
  pageCount: number;
  controlCount: number;
}): VantaManifest {
  const counted = ({ kind, count }: { kind: "browser-page" | "control"; count: number }): AtlasKindStatus => ({
    ...manifest.kinds[kind],
    digest: null,
    entityCount: count,
  });
  const advanced = withKindStatus<VantaKind, VantaManifest>({
    kind: "browser-page",
    manifest,
    status: counted({ count: pageCount, kind: "browser-page" }),
  });
  return withKindStatus<VantaKind, VantaManifest>({
    kind: "control",
    manifest: advanced,
    status: counted({ count: controlCount, kind: "control" }),
  });
}
