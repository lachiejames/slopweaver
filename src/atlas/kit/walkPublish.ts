/**
 * The two guards a walk PUBLISHER owes, and the tally it grades on.
 *
 * Both exist because a publisher that grades a claim cannot take the claim's own inputs on trust, and both
 * were found by counterexample rather than by design:
 *
 * - **The denominator is the constant, never the array a caller handed in.** A publisher comparing `reached`
 *   against `pages.length` publishes `synced` for a walk carrying an EMPTY array, because nought of nought
 *   is all of them. `crowdstrike/consoleSurface.ts` ships that shape, where a `--limit` slices the
 *   denominator before the walk sees it and the publisher then hard-codes `pagesExhausted: true`.
 * - **The evidence is the bytes, never the reference.** A caller can hand over an artifact REFERENCE with no
 *   file behind it, and a grader reading only the reference publishes `synced` coverage over screenshots
 *   that exist nowhere. The writer verifies what it writes — but the writer is a dependency the caller
 *   supplies, so the publisher verifies again over the store it is about to write into.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";

import { AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";
import type { AtlasArtifactRef } from "./contract.js";
import { isPageHeld, type PageObservation } from "./pageWalk.js";

/**
 * How many declared pages a walk landed on, and how many it also photographed.
 *
 * @internal
 */
export interface WalkTally {
  readonly reached: number;
  readonly photographed: number;
}

/**
 * How many declared pages this walk actually landed on, and how many it also photographed.
 *
 * @param pages every declared page's observation
 * @returns the two counts a coverage cell is graded on
 */
export function walkTally<TCall>({ pages }: { pages: readonly PageObservation<TCall>[] }): WalkTally {
  return {
    photographed: pages.filter((page) => isPageHeld({ page })).length,
    reached: pages.filter((page) => page.attempted && page.unreachableBecause === null).length,
  };
}

/**
 * Refuse a walk that did not cover the DECLARED list, before a single byte is published.
 *
 * Checked by SURFACE NAME against the declared constant, so a short walk, a duplicated row and a row for a
 * page that is not declared are each refused rather than published. See this file's header on why the
 * denominator may not come from the caller.
 *
 * Typed on the one field it reads, so a capture that is not a navigated page — a tab of a settings modal,
 * which has no address at all — is held to the same declared list by the same check.
 *
 * @param declaredSurfaces every surface name the atlas declares, from its own page inventory
 * @param pages the observations a caller is publishing
 * @returns nothing when they cover the declared list exactly, or why they do not
 */
export function refuseUndeclaredWalk({
  declaredSurfaces,
  pages,
}: {
  declaredSurfaces: readonly string[];
  pages: readonly { readonly surface: string }[];
}): Result<null> {
  const observed = pages.map((page) => page.surface);
  const missing = declaredSurfaces.filter((surface) => !observed.includes(surface));
  const undeclared = observed.filter((surface) => !declaredSurfaces.includes(surface));
  const duplicated = observed.filter((surface, index) => observed.indexOf(surface) !== index);
  if (missing.length === 0 && undeclared.length === 0 && duplicated.length === 0) {
    return ok(null);
  }
  const mismatch = AtlasCaptureErrors.walkCoverageMismatch({
    duplicated: duplicated.length,
    missing: missing.length,
    undeclared: undeclared.length,
  });
  return err(atlasCaptureErrorLines({ error: mismatch }));
}

/** Whether one artifact's bytes are on disk and still hash to the digest the reference carries. */
function artifactMatches({ artifact, directory }: { artifact: AtlasArtifactRef; directory: string }): boolean {
  try {
    const bytes = readFileSync(join(directory, artifact.relativePath));
    return (
      bytes.byteLength === artifact.byteLength && createHash("sha256").update(bytes).digest("hex") === artifact.sha256
    );
  } catch {
    return false;
  }
}

/**
 * Re-check every page's screenshot against the bytes on disk, before anything is graded.
 *
 * Cheap by construction: at most one read and one digest per declared page, over pictures the process just
 * captured. See this file's header on why a reference is not evidence. Typed on the two fields it reads and
 * writes, for the reason {@link refuseUndeclaredWalk} gives.
 *
 * @param pages the observations a caller is publishing
 * @param directory the atlas's own directory, which every artifact path is relative to
 * @returns the observations, with a missing or altered screenshot recorded on the page that lost it
 */
export function verifyArtifactsOnDisk<
  TPage extends { readonly artifacts: readonly AtlasArtifactRef[]; readonly screenshotMissingBecause: string | null },
>({ pages, directory }: { pages: readonly TPage[]; directory: string }): readonly TPage[] {
  return pages.map((page): TPage => {
    const unproven = page.artifacts.filter((artifact) => !artifactMatches({ artifact, directory }));
    if (unproven.length === 0) {
      return page;
    }
    return {
      ...page,
      artifacts: page.artifacts.filter((artifact) => artifactMatches({ artifact, directory })),
      screenshotMissingBecause: `${String(unproven.length)} of its screenshot(s) are absent from the atlas directory or no longer hash to the digest they are addressed by`,
    };
  });
}

/**
 * The three fields a walk REPLACES on one kind's file, plus its timestamp.
 *
 * Returned as an override rather than as a whole file so a caller spreads it onto its own stored document:
 * a helper that rebuilt the file would have to be generic over a platform's own kind-file type, and
 * TypeScript cannot prove a spread of a generic is still that generic. What matters is that the COVERAGE
 * rule lives once — every other surface's cell is carried forward and only this surface's is replaced, which
 * is the line a copy quietly gets wrong by replacing the whole array.
 *
 * @param stored the kind file as the store already holds it
 * @param entities this run's merged entities
 * @param cell the coverage cell this run earned for `surface`
 * @param surface which surface's cell is being replaced; every other cell is carried forward
 * @param gaps the reconciled gap list
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file
 *
 * @internal
 */
export function walkKindFields<TCell extends { readonly surface: string }, TEntity, TGap>({
  stored,
  entities,
  cell,
  surface,
  gaps,
  at,
}: {
  stored: { readonly coverage: readonly TCell[] };
  entities: readonly TEntity[];
  cell: TCell;
  surface: string;
  gaps: readonly TGap[];
  at: string;
}): { coverage: TCell[]; entities: TEntity[]; gaps: TGap[]; updatedAt: string } {
  return {
    coverage: [...stored.coverage.filter((existing) => existing.surface !== surface), cell],
    entities: [...entities],
    gaps: [...gaps],
    updatedAt: at,
  };
}

/**
 * What one kind's manifest row says after a successful run.
 *
 * @internal
 */
export interface KindStatusStamp {
  digest: string | null;
  entityCount: number;
  lastAttempt: { at: string; outcome: "ok"; reasons: string[] };
  lastSuccessAt: string;
}

/**
 * The manifest row a kind gets after a run that published it.
 *
 * @param count how many entities that kind now holds
 * @param at this run's ISO timestamp
 * @returns the stamped row
 *
 * @internal
 */
export function stampedKindStatus({ count, at }: { count: number; at: string }): KindStatusStamp {
  return { digest: null, entityCount: count, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at };
}

/**
 * Merge one channel, reconcile its gaps, and assemble the fields a walk replaces on one kind's file.
 *
 * The control flow is what is shared and what is worth sharing: merge, reconcile, abort on the FIRST
 * failure, and only then replace this surface's coverage cell while carrying every other one forward. A copy
 * of it is where one atlas ends up assembling a file from a failed merge, or replacing the whole coverage
 * array instead of its own cell — both of which look right in review and are only visible in a generation.
 *
 * The merge and the reconcile are thunks because each is a platform's own channel-scoped function, and
 * neither is a decision this helper should be making.
 *
 * @param stored the kind file as the store already holds it
 * @param merge this run's channel merge, deferred so a failure short-circuits before anything is assembled
 * @param reconcile this run's gap reconciliation, deferred for the same reason
 * @param cell the coverage cell this run earned for `surface`
 * @param surface which surface's cell is being replaced
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file, or the first reason the run cannot be assembled
 */
export function assembleWalkKind<TCell extends { readonly surface: string }, TEntity, TGap>({
  stored,
  merge,
  reconcile,
  cell,
  surface,
  at,
}: {
  stored: { readonly coverage: readonly TCell[] };
  merge: () => Result<readonly TEntity[]>;
  reconcile: () => Result<readonly TGap[]>;
  cell: TCell;
  surface: string;
  at: string;
}): Result<{ coverage: TCell[]; entities: TEntity[]; gaps: TGap[]; updatedAt: string }> {
  const entities = merge();
  if (entities.isErr()) {
    return err(entities.error);
  }
  const gaps = reconcile();
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok(walkKindFields({ at, cell, entities: entities.value, gaps: gaps.value, stored, surface }));
}

/**
 * The manifest rows a page walk stamps: the kind holding its pages and the kind holding the operations it
 * observed.
 *
 * Returned as a patch to spread into a manifest's own `kinds`, for the reason {@link walkKindFields} gives:
 * TypeScript cannot prove a spread of a generic manifest is still that manifest, so a helper that rebuilt
 * one would need a cast at every call site. Both kinds are named because every atlas that walks a page
 * surface writes exactly these two — the pages it reached and the methods it saw them call.
 *
 * @param pageCount how many page entities the walk published
 * @param methodCount how many method entities it published
 * @param at this run's ISO timestamp
 * @returns the two rows to spread into the manifest's `kinds`
 *
 * @internal
 */
export function stampedWalkKinds({
  pageCount,
  methodCount,
  at,
}: {
  pageCount: number;
  methodCount: number;
  at: string;
}): { method: KindStatusStamp; page: KindStatusStamp } {
  return {
    method: stampedKindStatus({ at, count: methodCount }),
    page: stampedKindStatus({ at, count: pageCount }),
  };
}

/**
 * What publishing a two-kind page walk did — the counts a CLI grades its exit code from, plus the paths
 * written.
 *
 * @internal
 */
export interface PageWalkPublished {
  readonly declaredCount: number;
  readonly reachedCount: number;
  readonly photographedCount: number;
  readonly operationCount: number;
  readonly written: readonly string[];
}

/**
 * The kind file the store holds for one kind. A store holding none has never published this kind, so a first
 * run merges onto the platform's own empty file for it.
 */
function storedKindFile<TFile>({
  files,
  kind,
  emptyFile,
}: {
  files: { readonly method: TFile | null; readonly page: TFile | null };
  kind: "method" | "page";
  emptyFile: (input: { kind: "method" | "page" }) => TFile;
}): TFile {
  const stored = files[kind];
  if (stored === null) {
    return emptyFile({ kind });
  }
  return stored;
}

/**
 * The seams a platform supplies to {@link publishPageWalk} — every step of the critical section, so each
 * atlas keeps its own store, schemas, file shapes and coverage rules.
 *
 * @internal
 */
export interface PageWalkSeams<
  TCall,
  TWalk extends { readonly pages: readonly PageObservation<TCall>[] },
  TFile extends { readonly entities: readonly unknown[] },
  TManifest,
> {
  /** What the walk observed, as handed in — its pages are re-verified before anything reads them. */
  readonly walk: TWalk;
  /** The atlas's own directory, which every artifact path is relative to. */
  readonly directory: string;
  /** How many pages the atlas declares, from its own inventory constant. */
  readonly declaredCount: number;
  /** The generation this run merges onto and publishes against. */
  readonly read: () => Result<{
    readonly files: { readonly method: TFile | null; readonly page: TFile | null };
    readonly manifest: TManifest | null;
  }>;
  /** The kind file a first run merges onto when the store holds none. */
  readonly emptyFile: (input: { kind: "method" | "page" }) => TFile;
  /** The operations the checked walk observed, as entities. */
  readonly projectMethods: (input: { walk: TWalk }) => readonly TFile["entities"][number][];
  /** Fold the checked walk's pages and gaps onto the stored page kind. */
  readonly mergePageFile: (input: { walk: TWalk; stored: TFile }) => Result<TFile>;
  /** Fold the observed operations onto the stored method kind's browser channel. */
  readonly mergeMethodFile: (input: {
    walk: TWalk;
    observed: readonly TFile["entities"][number][];
    stored: TFile;
  }) => Result<TFile>;
  /** The manifest to publish, given the merged counts. */
  readonly manifestFor: (input: { manifest: TManifest | null; methodCount: number; pageCount: number }) => TManifest;
  /** Write both files and then the manifest, compare-and-swapping against `derivedFrom`. */
  readonly publish: (input: {
    derivedFrom: TManifest | null;
    files: { method: TFile; page: TFile };
    manifest: TManifest;
  }) => Result<readonly string[]>;
}

/**
 * The read-merge-publish critical section a page walk's publisher runs, owned once rather than per atlas.
 *
 * A page walk writes two kinds — the pages it reached and the operations it saw them call — and the ORDER
 * of what it does with them is the property a copy loses: verify the artifacts against the bytes on disk
 * FIRST, so everything below grades the checked walk rather than the one handed in; read the generation
 * ONCE, so the manifest the publish compare-and-swaps against is the one both merges folded onto; abort on
 * the first failed merge before anything is written. It became a clone the gate could see, rather than one
 * only a reader could, when the per-atlas compare-and-swap moved into `./publish.ts`: the lines that still
 * differed between two atlases were the ones naming each atlas's own guard, and with those gone the two
 * functions were one function. Same story as `./compiledPublish.ts`.
 *
 * Every step is a seam, so each platform keeps its own store, schemas, file shapes and coverage rules. The
 * caller holds the platform's publish lock around this; nothing here acquires one.
 *
 * @returns what was published, or the first reason nothing was
 */
export function publishPageWalk<
  TCall,
  TWalk extends { readonly pages: readonly PageObservation<TCall>[] },
  TFile extends { readonly entities: readonly unknown[] },
  TManifest,
>({
  walk: raw,
  directory,
  declaredCount,
  read,
  emptyFile,
  projectMethods,
  mergePageFile,
  mergeMethodFile,
  manifestFor,
  publish,
}: PageWalkSeams<TCall, TWalk, TFile, TManifest>): Result<PageWalkPublished> {
  // Grade against the bytes on disk, never against the references a caller supplied — see
  // `verifyArtifactsOnDisk`. Everything below reads this checked walk rather than the one handed in.
  const walk: TWalk = { ...raw, pages: verifyArtifactsOnDisk({ directory, pages: raw.pages }) };
  const snapshot = read();
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const storedPages = storedKindFile({ emptyFile, files: snapshot.value.files, kind: "page" });
  const storedMethods = storedKindFile({ emptyFile, files: snapshot.value.files, kind: "method" });
  const operations = projectMethods({ walk });
  const pageFile = mergePageFile({ stored: storedPages, walk });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const methodFile = mergeMethodFile({ observed: operations, stored: storedMethods, walk });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  const published = publish({
    derivedFrom: snapshot.value.manifest,
    files: { method: methodFile.value, page: pageFile.value },
    manifest: manifestFor({
      manifest: snapshot.value.manifest,
      methodCount: methodFile.value.entities.length,
      pageCount: pageFile.value.entities.length,
    }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const tally = walkTally({ pages: walk.pages });
  return ok({
    declaredCount,
    operationCount: operations.length,
    photographedCount: tally.photographed,
    reachedCount: tally.reached,
    written: published.value,
  });
}
