/**
 * The parts of a driven-browser WALK that are the same whichever platform is being walked.
 *
 * A walk is briefed by a verb, carried out in the owner's own Chrome, and handed back as a document the verb
 * judges (`docs/browser-route.md`, `docs/browser-route/proof-and-capture-verbs.md`). What differs between
 * platforms is which addresses are walked and what a page MEANS there. What does not differ is the document's
 * own per-page shape, how a witness becomes a browser-channel entity, and when a walk may call itself
 * complete — and each of those had been written twice before this module, once by the GraphQL Hive atlas and
 * once, by copying it, by the WorkOS atlas.
 *
 * Same family as `kit/projection.ts` and `kit/withheld.ts`, same argument: a shape that regenerates through
 * ordinary careful work, because the next atlas's author opens whichever sibling they find first.
 *
 * ## The completeness bar is here because it is the part most worth not re-deciding
 *
 * `synced` requires every reached page to have been PHOTOGRAPHED as well, so a run that landed everywhere
 * and photographed nothing reports `deferred`. A surface that graded itself on pages-walked alone could
 * report complete while holding no proof of anything, and an atlas that quietly picked the laxer bar would
 * be incomparable with every other one's coverage fraction.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { atlasEntityWithChannel, sortedById } from "./channelProjection.js";
import type { AtlasArtifactRef } from "./contract.js";
import { walkKindFields } from "./walkPublish.js";

/**
 * One page the visible session actually visited, as its document records it.
 *
 * `screenshotPath` is nullable rather than required because a page can be reached while its capture fails
 * (`docs/browser-route/brief-profile-and-walks.md`). A page carrying no screenshot is `reached but not
 * photographed` rather than a failure.
 */
export const atlasWalkedPageSchema = z
  .object({
    /** The `page` entity's provider id, copied verbatim from what the brief printed. */
    providerId: z.string().min(1),
    requestedUrl: z.url(),
    finalUrl: z.string().min(1).nullable(),
    /** Whether the session landed on the page at all. */
    reached: z.boolean(),
    /** A local PNG path the session wrote, when its route can write files at all. */
    screenshotPath: z.string().min(1).nullable(),
    statusCode: z.number().int().nullable(),
    title: z.string().nullable(),
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/** One page a walk visited, as the document records it. */
export type AtlasWalkedPage = z.infer<typeof atlasWalkedPageSchema>;

/** One walked page's screenshot, already digested and written into the generation by the caller. */
export interface AtlasPageScreenshotRef {
  readonly providerId: string;
  readonly artifact: AtlasArtifactRef;
}

/** What publishing a walk did. A CLI grades its exit code from these counts. */
export interface AtlasWalkCounts {
  readonly declaredCount: number;
  readonly reachedCount: number;
  readonly photographedCount: number;
  readonly unreachableCount: number;
}

/**
 * The detail a walk writes about one page it visited.
 *
 * Deliberately NOT the platform's own page detail: a walk reports what it FOUND, never what was expected,
 * so the fields a route table owns (`purpose`, `needsAdmin`) are the API channel's and are supplied by the
 * caller rather than invented here.
 *
 * @internal
 */
export interface AtlasWalkedPageDetail {
  readonly finalUrl: string | null;
  readonly reachedAt: string | null;
  readonly title: string | null;
  readonly unreachableBecause: string | null;
}

/**
 * Count what a walk did.
 *
 * @param pages every page the document carried
 * @param photographed how many carried a screenshot this run stored
 * @returns the four counts, consistently derived so two atlases report the same thing
 *
 * @internal
 */
export function atlasWalkCounts({
  pages,
  photographed,
}: {
  pages: readonly AtlasWalkedPage[];
  photographed: number;
}): AtlasWalkCounts {
  const reachedCount = pages.filter((page) => page.reached).length;
  return {
    declaredCount: pages.length,
    photographedCount: photographed,
    reachedCount,
    unreachableCount: pages.length - reachedCount,
  };
}

/**
 * Whether a walk may call itself complete, and the line that says why.
 *
 * @param counts what the walk did
 * @param noun what this platform calls one of its pages, for the reason line — "console", "dashboard"
 * @returns the coverage state to publish and the reason to publish beside it
 */
export function atlasWalkCoverageDecision({ counts, noun }: { counts: AtlasWalkCounts; noun: string }): {
  readonly complete: boolean;
  readonly reason: string;
} {
  const complete =
    counts.reachedCount === counts.declaredCount &&
    counts.photographedCount === counts.reachedCount &&
    counts.declaredCount > 0;
  return {
    complete,
    reason:
      `${String(counts.reachedCount)} of ${String(counts.declaredCount)} declared ${noun} page(s) reached, ` +
      `${String(counts.photographedCount)} photographed`,
  };
}

/**
 * Project a walk's pages onto the browser channel, one entity each.
 *
 * The source's `observedAt` is the WALK's instant rather than this run's, because that is when the page was
 * actually seen; `firstSeenAt`/`lastSeenAt` carry the run's, which is what a merge folds against. Keeping
 * those two apart is why this builds its channel view rather than taking `atlasChannelView`'s default.
 *
 * @param pages every page the document carried
 * @param screenshots the artifact per photographed page
 * @param walkedAt the WALK's own instant, which is what a `reachedAt` and an `observedAt` must carry
 * @param at this run's ISO timestamp, which stamps the channel view's own first/last seen
 * @param purpose what this platform calls a witnessed page, written into the detail
 * @param entityId the platform's own namespaced identity hash for a page provider id
 * @param emptyChannels the platform's all-null channel map, so filling `browser` blanks nothing
 * @param extraDetail fields the platform's own page detail requires beyond what a walk observed
 * @returns one entity per walked page, sorted by id
 */
export function projectAtlasWalkedPages<TChannels extends Record<string, unknown>>({
  pages,
  screenshots,
  walkedAt,
  at,
  purpose,
  entityId,
  emptyChannels,
  extraDetail,
}: {
  pages: readonly AtlasWalkedPage[];
  screenshots: readonly AtlasPageScreenshotRef[];
  walkedAt: string;
  at: string;
  purpose: string;
  entityId: (args: { providerId: string }) => string;
  emptyChannels: TChannels;
  extraDetail: Readonly<Record<string, unknown>>;
}): readonly { channels: TChannels; id: string; kind: "page"; providerId: string }[] {
  const byProviderId = new Map(screenshots.map((shot) => [shot.providerId, shot.artifact]));
  const entities = pages.map((page) => {
    // A page the walk did not photograph carries no artifact.
    const artifact = byProviderId.get(page.providerId);
    const detail: AtlasWalkedPageDetail & Record<string, unknown> = {
      ...extraDetail,
      finalUrl: page.finalUrl,
      purpose,
      reachedAt: page.reached ? walkedAt : null,
      title: page.title !== null && page.title.length > 0 ? page.title : null,
      unreachableBecause: page.unreachableBecause,
    };
    return atlasEntityWithChannel({
      channel: "browser" as const,
      empty: emptyChannels,
      id: entityId({ providerId: page.providerId }),
      kind: "page" as const,
      providerId: page.providerId,
      view: {
        channel: "browser" as const,
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: artifact === undefined ? [] : [artifact],
          channel: "browser" as const,
          deepLink: page.requestedUrl,
          // The walk OPENED this address, which is the one thing that earns `browser-discovered`.
          deepLinkStatus: "browser-discovered" as const,
          endpoint: page.requestedUrl,
          observedAt: walkedAt,
        },
        state: "observed" as const,
      },
    });
  });
  return sortedById({ entities });
}

/**
 * The seams a platform supplies to {@link publishWalkedPageKind} — every step of the critical section, so
 * each atlas keeps its own store, schemas, file shape, coverage cell and gap condition.
 *
 * @internal
 */
export interface WalkedPageKindSeams<
  TFile extends {
    readonly coverage: readonly { readonly surface: string }[];
    readonly entities: readonly unknown[];
    readonly gaps: readonly unknown[];
    readonly updatedAt: string;
  },
  TManifest,
> {
  /** Every page the document carried, which the counts are graded from. */
  readonly pages: readonly AtlasWalkedPage[];
  /** How many carried a screenshot this run stored. */
  readonly photographed: number;
  /** The walked pages already projected onto the browser channel. */
  readonly observed: readonly TFile["entities"][number][];
  /** Which surface's coverage cell this walk replaces; every other cell is carried forward. */
  readonly surface: string;
  /** This run's ISO timestamp. */
  readonly at: string;
  /** The generation this run merges onto and publishes against. */
  readonly read: () => Result<{
    readonly files: { readonly page: TFile | null };
    readonly manifest: TManifest | null;
  }>;
  /** The page kind file a first run merges onto when the store holds none. */
  readonly emptyFile: () => TFile;
  /** Fold the observed pages onto the stored entities' browser channel. */
  readonly merge: (input: {
    observed: readonly TFile["entities"][number][];
    stored: readonly TFile["entities"][number][];
  }) => Result<readonly TFile["entities"][number][]>;
  /** The cell this walk earned, given what it counted. */
  readonly coverageFor: (input: { counts: AtlasWalkCounts }) => TFile["coverage"][number];
  /** The gap list to publish, given what the store already held. */
  readonly gapsFor: (input: { stored: TFile }) => readonly TFile["gaps"][number][];
  /** The manifest to publish, given the merged page count. */
  readonly manifestFor: (input: { manifest: TManifest | null; count: number }) => TManifest;
  /** Write the file and then the manifest, compare-and-swapping against `derivedFrom`. */
  readonly publish: (input: {
    derivedFrom: TManifest | null;
    file: TFile;
    manifest: TManifest;
  }) => Result<readonly string[]>;
}

/**
 * The read-merge-publish critical section a driven-browser walk's publisher runs, owned once rather than
 * per atlas.
 *
 * A walk of this family writes ONE kind — the pages the session witnessed — onto that kind's browser
 * channel, and the order inside the section is the property a copy loses: read the generation ONCE, so the
 * manifest the publish compare-and-swaps against is the one the merge folded onto; abort on a failed merge
 * before anything is assembled; replace only this surface's coverage cell and carry every other one
 * forward. It became a clone the gate could see, rather than one only a reader could, when the per-atlas
 * compare-and-swap moved into `./publish.ts`: the lines that still differed between the Hive and WorkOS
 * publishers were the ones naming each atlas's own guard, and with those gone the two functions were one
 * function. Same story as `./compiledPublish.ts` and `./walkPublish.ts`'s `publishPageWalk`.
 *
 * Every step is a seam, so each platform keeps its own store, schemas, file shape, coverage cell and gap
 * condition. The caller holds the platform's publish lock around this; nothing here acquires one.
 *
 * @returns what was published, or the first reason nothing was
 */
export function publishWalkedPageKind<
  TFile extends {
    readonly coverage: readonly { readonly surface: string }[];
    readonly entities: readonly unknown[];
    readonly gaps: readonly unknown[];
    readonly updatedAt: string;
  },
  TManifest,
>({
  pages,
  photographed,
  observed,
  surface,
  at,
  read,
  emptyFile,
  merge,
  coverageFor,
  gapsFor,
  manifestFor,
  publish,
}: WalkedPageKindSeams<TFile, TManifest>): Result<AtlasWalkCounts & { readonly written: readonly string[] }> {
  const snapshot = read();
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  let stored: TFile;
  if (snapshot.value.files.page === null) {
    stored = emptyFile();
  } else {
    stored = snapshot.value.files.page;
  }
  const merged = merge({ observed, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const counts = atlasWalkCounts({ pages, photographed });
  const file: TFile = {
    ...stored,
    ...walkKindFields({
      at,
      cell: coverageFor({ counts }),
      entities: merged.value,
      gaps: gapsFor({ stored }),
      stored,
      surface,
    }),
  };
  const published = publish({
    derivedFrom: snapshot.value.manifest,
    file,
    manifest: manifestFor({ count: file.entities.length, manifest: snapshot.value.manifest }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ ...counts, written: published.value });
}
