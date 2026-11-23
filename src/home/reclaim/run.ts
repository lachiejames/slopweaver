/**
 * One reclaim, root by root: measure, report, and — only under `--apply` — remove and then prove nothing
 * else went with it.
 *
 * The witness is the part worth reading. A delete cannot be undone here, so "it was safe" has to be a
 * CHECKED claim rather than an argument: `findSpentScratch` returns every path the walk KEPT — every
 * top-level entry it did not take, by name, and every regular file outside the spent scratch workspaces, so
 * every pass record and every unfinished scratch — and after the removal every one of them is `lstat`ed
 * again. An empty directory or a link deeper than the top level is not among them. A run that cannot show that reports
 * `WITNESS_FAILED` and names the paths that went missing. Per `.claude/rules/testing.md`, an absence is only
 * evidence when the input CARRIES what it calls absent — so this asserts the positive side, that the pass
 * records the reclaim says it preserved are still there, rather than that no error was printed.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { type HomeReclaimError, HomeReclaimErrors } from "./errors.js";
import { isFinishedScratch, type SpentScratch } from "./finishedScratch.js";
import type { ReclaimRoot } from "./roots.js";
import { removeEntry, stillExists, walkFiles } from "./scan.js";

/** What one root's reclaim found and, under `--apply`, did. */
export interface RootOutcome {
  readonly root: string;
  readonly takes: string;
  readonly because: string;
  /** Entries the run would remove, or did. */
  readonly entries: readonly string[];
  readonly freedBytes: number;
  readonly examined: number;
  readonly applied: boolean;
  readonly witnessHeld: boolean;
}

/** Everything a reclaim touches outside itself. */
export interface ReclaimDeps {
  /** Absolute `$SLOPWEAVER_HOME`. */
  readonly home: string;
  /** Progress, so a walk of a hundred thousand files is observable rather than a silent hang. */
  readonly progress: (input: { line: string }) => void;
}

/**
 * Reclaim the `finished-scratch` class from a root: the whole scratch workspace of every finished Codex pass.
 *
 * @param root the declared root
 * @param deps the home and the progress channel
 * @param apply whether to remove, rather than only report
 * @returns what it found and did, or the typed failure
 */
export function reclaimFinishedScratch({
  root,
  deps,
  apply,
}: {
  root: ReclaimRoot;
  deps: ReclaimDeps;
  apply: boolean;
}): Result<RootOutcome, HomeReclaimError> {
  const absolute = join(deps.home, root.homeSegment);
  const isRealDirectory = rootIsRealDirectory({ absolute });
  if (isRealDirectory.isErr()) {
    return err(isRealDirectory.error);
  }
  const finished = finishedPassIds({ absolute });
  if (finished.isErr()) {
    return err(finished.error);
  }
  deps.progress({
    line: `home reclaim: ${String(finished.value.size)} finished Codex pass(es) under ${absolute}`,
  });
  const found = findSpentScratch({ absolute, deps, finishedPassIds: finished.value });
  if (found.isErr()) {
    return err(found.error);
  }
  const { kept, spent } = found.value;
  const outcome = {
    applied: apply,
    because: root.because,
    entries: spent.map((scratch) => scratch.relativePath),
    examined: finished.value.size,
    freedBytes: spent.reduce((total, scratch) => total + scratch.bytes, 0),
    root: root.name,
    takes: root.takes,
    witnessHeld: true,
  } satisfies RootOutcome;
  if (!apply) {
    return ok(outcome);
  }
  for (const scratch of spent) {
    const stillReal = rootIsRealDirectory({ absolute });
    if (stillReal.isErr()) {
      return err(stillReal.error);
    }
    const removal = removeEntry({ relativePath: scratch.relativePath, root: absolute });
    if (removal.isErr()) {
      return err(removal.error);
    }
  }
  return keptPathWitness({ absolute, deps, kept, outcome });
}

/**
 * Prove the removal took ONLY the spent scratch workspaces: every file the walk kept — which by construction
 * is every file outside them — still exists.
 *
 * Without this the old build-tree take journalled `witnessHeld: true` having checked nothing, which its r1
 * review caught: a ledger row asserting a witness that never ran is worse than one admitting there was none.
 * The claim is falsifiable in the direction that matters, because `kept` CARRIES the pass records the
 * reclaim says it preserved — every `record.json` and `artifact.md`, and every file of a pass still running.
 *
 * @param absolute `$SLOPWEAVER_HOME/orchestration`
 * @param kept every path outside the removed workspaces, as the walk saw it beforehand
 * @param outcome what the run did, returned unchanged when the witness holds
 * @param deps the progress channel
 * @returns the outcome, or `WITNESS_FAILED` naming what went missing
 */
function keptPathWitness({
  absolute,
  kept,
  outcome,
  deps,
}: {
  absolute: string;
  kept: readonly string[];
  outcome: RootOutcome;
  deps: ReclaimDeps;
}): Result<RootOutcome, HomeReclaimError> {
  deps.progress({ line: `home reclaim: checking the witness — ${String(kept.length)} kept path(s)` });
  const lostPaths = kept.filter((relativePath) => !stillExists({ path: join(absolute, relativePath) }));
  if (lostPaths.length > 0) {
    return err(HomeReclaimErrors.witnessFailed({ lostPaths }));
  }
  return ok(outcome);
}

/**
 * Refuse a declared root that is a symlink or not a directory, by `lstat` of the root itself.
 *
 * `./scan.ts` never follows a link it meets as an ENTRY, but the walk opens its root with `readdirSync`,
 * which does — so without this an `orchestration` that links elsewhere would have its finished scratch
 * deleted wherever it resolves, and the witness, walking the same resolution, would hold. The home above the root may itself be a link; that is the operator's choice of where the home
 * lives, not a path this verb picks.
 *
 * Asked again before every removal, which narrows a swap of the root between the check and the `rmSync` to
 * one entry's width but cannot close it: Node has no `unlinkat` against a held directory handle. A process
 * running as the same user that races the root is out of scope here for the reason
 * `../../codex/artifactStore.ts`'s threat model gives — it can already delete the home outright.
 *
 * @param absolute `$SLOPWEAVER_HOME/<segment>`
 * @returns true when the root is a real directory, or the refusal naming it
 */
function rootIsRealDirectory({ absolute }: { absolute: string }): Result<true, HomeReclaimError> {
  const stats = safeFs({ execute: () => lstatSync(absolute), operation: "home.reclaim.root", path: absolute });
  if (stats.isErr()) {
    return err(HomeReclaimErrors.scanFailed({ cause: stats.error.cause, path: absolute }));
  }
  if (stats.value.isSymbolicLink() || !stats.value.isDirectory()) {
    return err(HomeReclaimErrors.rootNotDirectory({ path: absolute }));
  }
  return ok(true);
}

/**
 * Every pass id whose artifact exists, so its scratch workspace is known finished.
 *
 * @param absolute `$SLOPWEAVER_HOME/orchestration`
 * @returns the finished ids, or the typed io failure
 */
function finishedPassIds({ absolute }: { absolute: string }): Result<ReadonlySet<string>, HomeReclaimError> {
  const artifacts = walkFiles({
    root: absolute,
    skip: ({ relativePath }) => relativePath.split("/").length > 1,
  });
  if (artifacts.isErr()) {
    return err(artifacts.error);
  }
  const ids = new Set<string>();
  for (const file of artifacts.value) {
    const segments = file.relativePath.split("/");
    const id = segments[0];
    if (segments.length === 2 && segments[1] === "artifact.md" && id !== undefined) {
      ids.add(id);
    }
  }
  return ok(ids);
}

/**
 * Find every finished pass's scratch workspace, pruning the walk at each one, and keep every other path.
 *
 * Only a top-level DIRECTORY is ever a candidate: the walk asks `skip` only of an entry it would descend, and
 * a symlink is never descended (`./scan.ts`), so a `<passId>.scratch` that is a link is never taken. Every
 * record directory and every unfinished scratch is walked in full, and every top-level entry not taken is
 * named as well, which together are the witness's subject.
 *
 * @param absolute `$SLOPWEAVER_HOME/orchestration`
 * @param finishedPassIds the pass ids whose scratch is spent
 * @param deps the progress channel, for the sizing walk
 * @returns the spent workspaces with the bytes beneath each, and every path the walk kept, for the witness
 */
function findSpentScratch({
  absolute,
  deps,
  finishedPassIds: finished,
}: {
  absolute: string;
  deps: ReclaimDeps;
  finishedPassIds: ReadonlySet<string>;
}): Result<{ readonly spent: readonly SpentScratch[]; readonly kept: readonly string[] }, HomeReclaimError> {
  const spent: string[] = [];
  const found = walkFiles({
    root: absolute,
    skip: ({ relativePath }) => {
      if (relativePath.includes("/")) {
        return false;
      }
      if (!isFinishedScratch({ entryName: relativePath, finishedPassIds: finished })) {
        return false;
      }
      if (isRecordShaped({ directory: join(absolute, relativePath) })) {
        return false;
      }
      spent.push(relativePath);
      return true;
    },
  });
  if (found.isErr()) {
    return err(found.error);
  }
  deps.progress({ line: `home reclaim: sizing ${String(spent.length)} spent scratch workspace(s)` });
  const sized: SpentScratch[] = [];
  for (const relativePath of spent.toSorted()) {
    const one = sizeScratch({ absolute, relativePath });
    if (one.isErr()) {
      return err(one.error);
    }
    sized.push(one.value);
  }
  const topLevel = topLevelNames({ absolute });
  if (topLevel.isErr()) {
    return err(topLevel.error);
  }
  const taken = new Set(spent);
  const keptTopLevel = topLevel.value.filter((name) => !taken.has(name));
  const kept = new Set([...keptTopLevel, ...found.value.map((file) => file.relativePath)]);
  return ok({ kept: [...kept], spent: sized });
}

/**
 * Whether a directory holds a pass record's own files, so it is a record directory whatever its name says.
 *
 * A name ending `.scratch` is not proof of a scratch: `../../codex/artifactStore.ts` takes the pass id as
 * given, so a record written under the id `foo.scratch` sits exactly where `foo`'s scratch would, and the
 * name rule alone would delete it. Measured on the real home: no scratch
 * carries either file at its top, so this costs nothing reclaimed —
 * `find "$SLOPWEAVER_HOME/orchestration" -mindepth 2 -maxdepth 2 -path '*.scratch/*' \( -name record.json -o -name artifact.md \) | wc -l`
 * printed 0.
 *
 * @param directory the absolute candidate
 * @returns whether a `record.json` or an `artifact.md` stands directly inside it
 */
function isRecordShaped({ directory }: { directory: string }): boolean {
  return stillExists({ path: join(directory, "record.json") }) || stillExists({ path: join(directory, "artifact.md") });
}

/**
 * Every entry directly below the root, whatever it is — so the witness re-checks an empty unfinished
 * scratch, a record directory and a top-level link by name, none of which the file walk returns. Below the top level the witness sees regular files only: an empty directory or a link deeper
 * inside a kept tree is not re-checked, and nothing this verb removes can reach one.
 *
 * @param absolute `$SLOPWEAVER_HOME/orchestration`
 * @returns the entry names, or the typed io failure
 */
function topLevelNames({ absolute }: { absolute: string }): Result<readonly string[], HomeReclaimError> {
  const names = safeFs({ execute: () => readdirSync(absolute), operation: "home.reclaim.readdir", path: absolute });
  if (names.isErr()) {
    return err(HomeReclaimErrors.scanFailed({ cause: names.error.cause, path: absolute }));
  }
  return ok(names.value);
}

/**
 * Count the bytes a removal of one workspace frees — the walk skipped it, so it is counted separately.
 *
 * A file whose inode another path still holds (`links > 1`) frees nothing when this path goes, so it is not
 * counted: `./scan.ts` carries why a figure that counted it would be a fabrication. A sizing walk that fails
 * stops the run before anything is removed, rather than journalling a figure nobody measured.
 *
 * @param absolute `$SLOPWEAVER_HOME/orchestration`
 * @param relativePath the `<passId>.scratch` directory's name
 * @returns the workspace with its real size, or the io failure that stopped the walk
 */
function sizeScratch({
  absolute,
  relativePath,
}: {
  absolute: string;
  relativePath: string;
}): Result<SpentScratch, HomeReclaimError> {
  const inside = walkFiles({ root: join(absolute, relativePath), skip: () => false });
  if (inside.isErr()) {
    return err(inside.error);
  }
  const bytes = inside.value.reduce((total, file) => total + (file.links === 1 ? file.allocatedBytes : 0), 0);
  return ok({ bytes, relativePath });
}
