/**
 * Publish the Jam atlas's compiled generation — the two surfaces that need no credential and no request at
 * all.
 *
 * ## Why a sync that calls nothing is still a sync
 *
 * `resyncCommand` is a first-class requirement of the descriptor contract: one command that brings the whole
 * atlas current. Here the compiled channel is the half that CAN be current with nothing configured, so it is
 * what this publishes — fourteen published operations, four declared scopes, twenty-three probed routes,
 * nine published integration pages, and, for every kind, the coverage cells and gaps that say exactly what
 * the other two channels have not done. Every array it writes is sorted, so two runs given the same `at`
 * produce byte-identical files; the timestamp is the only thing that moves between runs, which is what makes
 * a real diff over a regenerated atlas readable.
 *
 * ## The one thing it REFUSES, and why the refusal is here rather than in the probe
 *
 * The route surface's whole claim rests on two 404s meaning different things, and a probe whose negative has
 * stopped firing is measuring nothing rather than measuring something reassuring. So this refuses to publish
 * a table whose control rows are not all `not-routed` — the check sits at the PUBLISH boundary rather than
 * inside the generator, because a generator can be re-run by hand while a publish is what a reader trusts.
 *
 * ## What it does NOT do
 *
 * It never reaches the network, so it can never fill the MCP channel or the browser one. Both get an honest
 * `not-configured` cell naming what would unblock them — on a kind no other channel has filled yet, which is
 * the difference between an atlas that is honest about its gaps and one that looks empty. A channel that HAS
 * been filled keeps its own cell; a sync telling a reader the browser is not configured on a kind holding
 * seventeen witnessed pages would be a false statement the store then serves.
 *
 * ## It publishes a FOLD of what is held, never a replacement for it
 *
 * The compiled channel is one of three, so this publishes the compiled channel and carries every other one
 * forward: `merge.ts` states the contract and `browserSurface.ts` has always kept its half of it. Written as
 * a whole-generation overwrite, this half emptied the `page` kind — the one kind the compiled channel
 * contributes nothing to — on every run that followed a walk, and the `kit/evidenceLoss.ts` guard refused
 * every publish rather than erase seventeen real pages. `operation` and `integration`
 * lost their browser channel the same way and nothing reported it, because a kind that SHRINKS without being
 * emptied trips no rule. The fold is per channel and per kind for that reason, not a special case for
 * `page`. The same owner ruling `kit/evidenceLoss.ts` cites applies: a sync is a soft reconcile, and
 * `atlas jam reset` is the hard path.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type JamAtlasError, JamAtlasErrors } from "./errors.js";
import { JAM_ROUTES } from "./generated/surfaces.js";
import { JAM_ATLAS_KINDS, type JamAtlasKind, type JamAtlasKindFile, type JamAtlasManifest } from "./model.js";
import { type JamAtlasPaths, jamAtlasPaths, publishJamAtlas, readJamAtlas, withJamPublishLock } from "./store.js";
import { foldedKindFiles, type JamHeldGeneration, syncManifest } from "./syncFold.js";

/** What one publish produced, so a verb can report it without re-reading the store. */
export interface JamSyncReport {
  /** How many entities were written, per kind, in kind order. */
  readonly entitiesByKind: readonly { readonly kind: JamAtlasKind; readonly entities: number }[];
  /** How many gaps the generation carries. */
  readonly gaps: number;
  /** Every file written, in write order — kind files first, manifest last. */
  readonly written: readonly string[];
}

/**
 * Refuse a table whose control rows have stopped proving the probe's negative fires.
 *
 * @returns nothing when the control still answers `not-routed` on every host, or why the publish is refused
 */
function controlInvariant(): Result<null, JamAtlasError> {
  const controls = JAM_ROUTES.filter((route) => route.control);
  if (controls.length === 0) {
    return err(
      JamAtlasErrors.registryInvalid({
        detail:
          "the route table carries no control row, so its negative cannot be shown to fire and every " +
          "`not-routed` verdict in it is unevidenced",
      }),
    );
  }
  const wrong = controls.filter((route) => route.verdict !== "not-routed");
  if (wrong.length > 0) {
    return err(
      JamAtlasErrors.registryInvalid({
        detail:
          `${String(wrong.length)} control row(s) graded something other than not-routed ` +
          `(${wrong.map((route) => `${route.host}${route.path} → ${route.verdict}`).join(", ")}), so a host ` +
          "has started answering the application router's not-found to paths it does not serve and every " +
          "`routed-no-leaf` verdict in this table is suspect. Re-run `yarn tsx tools/generateJamSurfaces.ts`",
      }),
    );
  }
  return ok(null);
}

/**
 * Build the whole compiled generation in memory, folded onto what the store already holds.
 *
 * Separated from the read and the write so the shape is testable without a filesystem — every judgement in
 * this module is pure, the held generation arrives as a value, and the only I/O is in {@link syncJamAtlas}.
 *
 * @param at this run's ISO timestamp
 * @param held what the store already holds, defaulting to a first publish
 * @returns every kind file and the manifest, or why the committed table cannot be trusted
 */
export function buildJamGeneration({
  at,
  held = { files: {}, manifest: null },
}: {
  at: string;
  held?: JamHeldGeneration;
}): Result<
  { readonly files: Record<JamAtlasKind, JamAtlasKindFile>; readonly manifest: JamAtlasManifest },
  JamAtlasError
> {
  const control = controlInvariant();
  if (control.isErr()) {
    return err(control.error);
  }
  const files = foldedKindFiles({ at, held });
  if (files.isErr()) {
    return err(files.error);
  }
  return ok({ files: files.value, manifest: syncManifest({ at, files: files.value, held }) });
}

/**
 * Read what is held, fold this run's compiled channel onto it, and publish — all under the publish lock.
 *
 * The lock is what the walk has always taken, and it is what makes the read-then-write here safe: a
 * generation derived from a snapshot is a lost update the moment the other channel writes between the two.
 * `readJamAtlas` is also what establishes the `derivedFrom` the compare-and-swap asserts — the same value in
 * both roles rather than two reads that could disagree.
 *
 * @param paths the resolved paths
 * @param at this run's ISO timestamp
 * @returns what was written, or why publication was refused
 */
function foldAndPublish({ paths, at }: { paths: JamAtlasPaths; at: string }): Result<JamSyncReport, JamAtlasError> {
  const snapshot = readJamAtlas({ paths });
  if (snapshot.isErr()) {
    return err(JamAtlasErrors.storeUnreadable({ reasons: snapshot.error }));
  }
  const generation = buildJamGeneration({
    at,
    held: { files: snapshot.value.files, manifest: snapshot.value.manifest },
  });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const { files, manifest } = generation.value;
  const written = publishJamAtlas({ derivedFrom: snapshot.value.manifest, files, manifest, paths });
  if (written.isErr()) {
    return err(JamAtlasErrors.storeUnwritable({ reasons: written.error }));
  }
  return ok({
    entitiesByKind: JAM_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    gaps: JAM_ATLAS_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0),
    written: written.value,
  });
}

/**
 * Publish the compiled generation, folded onto what the store holds.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` to publish into
 * @param at this run's ISO timestamp
 * @returns what was written, or why publication was refused
 */
export function syncJamAtlas({ home, at }: { home: string; at: string }): Result<JamSyncReport, JamAtlasError> {
  const paths = jamAtlasPaths({ home });
  // The lock's own `Result` carries the reason the LOCK could not be taken, so this run's typed failure
  // rides inside it rather than being flattened into strings and losing its `code`. The lock releases in a
  // `finally`, so an inner failure reported as an outer success releases exactly as an outer failure does.
  const published = withJamPublishLock<Result<JamSyncReport, JamAtlasError>>({
    nowIso: at,
    paths,
    publish: () => ok(foldAndPublish({ at, paths })),
  });
  if (published.isErr()) {
    return err(JamAtlasErrors.storeUnwritable({ reasons: published.error }));
  }
  return published.value;
}
