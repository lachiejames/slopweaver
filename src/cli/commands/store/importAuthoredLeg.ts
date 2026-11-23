/**
 * `store import-fleet --only authored` — every file under the home's `authored` directories, into
 * `authored_body` and `authored_file`.
 *
 * Which directories those are is `../../../store/fleet/authoredDirectories.ts`; the table shape and why it is
 * content-addressed is `../../../store/schema/authored.ts`. Files are read one at a time and streamed into the
 * store in bounded batches (`../../../store/fleet/authoredStore.ts`), in one transaction, every insert `DO
 * NOTHING` — so a second run over an unchanged home writes zero rows. `authored_absent`, the stored paths the
 * walk did not find, is `./importAuthoredAbsence.ts`.
 *
 * Against the default home the walk is preceded by the Claude Code auto-memory mirror
 * (`../../../store/fleet/claudeMemoryMirror.ts`): each `~/.claude/projects/<project-dir>/memory` is copied into
 * `claude-memory/<project-dir>/`, so the walk carries it like any other authored file.
 *
 * A file that trips a secret class is REFUSED by name and never written. A binary body is scanned as raw bytes
 * and a git bundle's pack inflated and scanned too; both are counted in the leg's notes, because a secret inside
 * an image's compressed data is the one thing neither sees — the gap is printed rather than implied away.
 *
 * Before any of that, the retention step (`./importAuthoredRetention.ts`) takes OUT of the store what no longer
 * belongs in it: every version of a path the classification now keeps local-only, and every tool answer an earlier
 * import stored inside a call file. A call file's tool answers are stripped before it is hashed and stored, so the
 * store copy of `talk/calls/` is the call without what each tool returned.
 *
 * A listed file deleted before its read is not a refusal: it is named in a note and counts as absent on this run
 * (`./importAuthoredRead.ts`). A file still there that will not read stays a refusal.
 */
import { loadDenylistResult } from "../../../hygiene/scan.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { StoreClient } from "../../../store/client.js";
import { type ProjectedAuthoredFile, projectAuthoredFile } from "../../../store/fleet/authoredFile.js";
import { listAuthoredFiles } from "../../../store/fleet/authoredFiles.js";
import { importAuthoredFiles } from "../../../store/fleet/authoredStore.js";
import { syncClaudeMemoryMirror } from "../../../store/fleet/claudeMemorySync.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { homeRelativePath } from "../../../store/fleet/homeWalk.js";

import { absenceNotes } from "./importAuthoredAbsence.js";
import { readListedFile, vanishedListedFileNotes } from "./importAuthoredRead.js";
import { runAuthoredRetention } from "./importAuthoredRetention.js";
import type { LegOutcome } from "./importFleetCore.js";

/** What the projection counted as it read. */
interface AuthoredTally {
  projected: number;
  binary: number;
  bundles: number;
  bytes: number;
  /** Home-relative paths the walk listed that were gone by the read. */
  vanished: string[];
}

/**
 * Every authored file, projected one at a time; a file that will not project is pushed onto `refused`, and one
 * deleted since the walk onto `tally.vanished` (`./importAuthoredRead.ts`).
 *
 * @param files the absolute paths the walk found
 * @param home the state home the paths are made relative to
 * @param denylist the private denylist's words
 * @param refused where each refusal is recorded
 * @param tally counted as files are yielded
 * @returns a generator of projected files, in walk order
 */
function* projectedFiles({
  files,
  home,
  denylist,
  refused,
  tally,
}: {
  files: readonly string[];
  home: string;
  denylist: readonly string[];
  refused: FleetImportError[];
  tally: AuthoredTally;
}): Generator<ProjectedAuthoredFile> {
  for (const path of files) {
    const relativePath = homeRelativePath({ home, path });
    const read = readListedFile({ path });
    if (read.kind === "vanished") {
      tally.vanished.push(relativePath);
      continue;
    }
    if (read.kind === "unreadable") {
      refused.push(FleetImportErrors.unstorableAuthoredFile({ path: relativePath, reason: read.reason }));
      continue;
    }
    const { bytes, fileModifiedAt } = read;
    const projected = projectAuthoredFile({ bytes, denylist, fileModifiedAt, relativePath });
    if (projected.isErr()) {
      refused.push(projected.error);
      continue;
    }
    tally.projected += 1;
    tally.bytes += bytes.length;
    if (projected.value.bundle) {
      tally.bundles += 1;
    }
    if (projected.value.binary) {
      tally.binary += 1;
    }
    yield projected.value;
  }
}

/**
 * Write the projected files, or on a dry run only drain them — which still reads, hashes and scans every file,
 * so a dry run's counts and refusals are the real ones.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param files the projection, drained exactly once either way
 * @param home names the leg in a write failure
 * @param refused where a write failure is recorded
 * @returns new bodies plus new locations, zero on a dry run or a failed write
 */
async function writeOrDrain({
  client,
  files,
  home,
  refused,
}: {
  client: StoreClient | undefined;
  files: Iterable<ProjectedAuthoredFile>;
  home: string;
  refused: FleetImportError[];
}): Promise<number> {
  if (client === undefined) {
    const drain = files[Symbol.iterator]();
    while (drain.next().done !== true) {
      continue;
    }
    return 0;
  }
  const counts = await importAuthoredFiles({ client, files });
  if (counts.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: counts.error.message }));
    return 0;
  }
  return counts.value.bodies + counts.value.locations;
}

/**
 * The lines naming every entry a `split` directory holds with no row of its own — read by nothing until
 * `../../../store/fleet/authoredDirectories.ts` classifies it, and said so on every run.
 *
 * @param unclassified the home-relative entries the walk found unclassified
 * @returns no line when there are none, else a count and the entries
 */
export function unclassifiedNotes({ unclassified }: { unclassified: readonly string[] }): readonly string[] {
  if (unclassified.length === 0) {
    return [];
  }
  return [
    `${String(unclassified.length)} unclassified entr(ies) under a split directory, not read until authoredDirectories.ts names them: ${unclassified.join(", ")}`,
  ];
}

/**
 * Mirror Claude Code's auto-memory into the home, so the walk that follows carries it — or on a dry run only
 * plan it, since a dry run writes nothing. A corpus or mirror directory that would not read is a refusal, like
 * an authored directory that would not read; the mirror's own files are then scanned by the walk as usual.
 *
 * @param projectsDir Claude Code's `~/.claude/projects`
 * @param home the state home the mirror lives under
 * @param apply whether to write the mirror
 * @param now the current epoch milliseconds
 * @param refused where a failure is recorded
 * @returns the note lines
 */
function claudeMemoryNotes({
  projectsDir,
  home,
  apply,
  now,
  refused,
}: {
  projectsDir: string;
  home: string;
  apply: boolean;
  now: number;
  refused: FleetImportError[];
}): readonly string[] {
  const synced = syncClaudeMemoryMirror({ apply, mirrorRoot: stateHomePaths({ home }).claudeMemory, now, projectsDir });
  if (synced.isErr()) {
    refused.push(
      FleetImportErrors.unstorableAuthoredFile({
        path: projectsDir,
        reason: `Claude Code's projects directory would not list, so no auto-memory was mirrored: ${synced.error}`,
      }),
    );
    return [];
  }
  const { plan, corpora, recent, unreadable } = synced.value;
  for (const failure of unreadable) {
    refused.push(
      FleetImportErrors.unstorableAuthoredFile({
        path: failure.locator,
        reason: `the auto-memory directory would not read, so its mirror was left as it was: ${failure.why}`,
      }),
    );
  }
  const verb = apply ? "" : "would be ";
  return [
    `${String(corpora)} Claude auto-memory corpus(es) mirrored into claude-memory: ${String(plan.write.length)} file(s) ${verb}written, ${String(plan.remove.length)} ${verb}removed, ${String(plan.retire.length)} replaced version(s) ${verb}kept in an attic`,
    ...(recent.length === 0
      ? []
      : [`  left out, changed in the last minute: ${recent.join(", ")} — mirrored on the next pass`]),
  ];
}

/** An authored directory the walk could not read, as the refusal the leg reports. */
function unreadableDirectoryRefusal({
  unreadable,
}: {
  unreadable: { locator: string; why: string };
}): FleetImportError {
  return FleetImportErrors.unstorableAuthoredFile({
    path: unreadable.locator,
    reason: `the directory would not read: ${unreadable.why}`,
  });
}

/** The refusal for a hygiene denylist that exists and will not read, which stops the whole leg. */
function unreadableDenylistRefusal({ path, reason }: { path: string; reason: string }): FleetImportError {
  return FleetImportErrors.unstorableAuthoredFile({
    path,
    reason: `the hygiene denylist would not read (${reason}), so no body can be checked for a secret`,
  });
}

/**
 * Project every authored file and, unless this is a dry run, write the rows.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home the state home whose authored directories are read
 * @param claudeProjects Claude Code's `~/.claude/projects`, whose auto-memory is mirrored into the home before
 *   the walk — given only for the default home, so an import against a throwaway `--home` never reads the
 *   operator's corpora
 * @param now the current epoch milliseconds, for the mirror's quiet window
 * @returns what this leg did — `written` is new bodies plus new locations, so a re-run over an unchanged home
 *   reports zero
 */
export async function runAuthoredLeg({
  client,
  home,
  claudeProjects,
  now = Date.now(),
}: {
  client: StoreClient | undefined;
  home: string;
  claudeProjects?: string;
  now?: number;
}): Promise<LegOutcome> {
  const refused: FleetImportError[] = [];
  const tally: AuthoredTally = { binary: 0, bundles: 0, bytes: 0, projected: 0, vanished: [] };
  const base = { absentSource: undefined, leg: "authored" as const, unreadableLines: 0 };
  // Retention only ever takes data OUT of the store — a local-only path's rows, or a call version rewritten as a
  // strict subset of bytes already stored and scanned — so it needs no denylist and no later refusal holds it back.
  const retention = await runAuthoredRetention({ client, home, refused });
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    // A denylist that exists and cannot be read would scan every body against nothing and store what it
    // should have refused, so the leg writes nothing at all rather than a half-checked set.
    refused.push(unreadableDenylistRefusal({ path: denylist.path, reason: denylist.reason }));
    return { ...base, notes: retention.notes, projected: 0, refused, written: retention.written };
  }
  const mirrored =
    claudeProjects === undefined
      ? []
      : claudeMemoryNotes({ apply: client !== undefined, home, now, projectsDir: claudeProjects, refused });
  const listing = listAuthoredFiles({ home });
  listing.unreadable.forEach((unreadable) => refused.push(unreadableDirectoryRefusal({ unreadable })));
  const files = projectedFiles({
    denylist: denylist.kind === "loaded" ? denylist.lines : [],
    files: listing.files,
    home,
    refused,
    tally,
  });
  const written = await writeOrDrain({ client, files, home, refused });
  // `tally.vanished` is whole only when the write drained every file. A write that failed mid-stream stopped the
  // reads and recorded LEG_WRITE_FAILED, and `absenceWithheldBecause` then writes no absence from a partial walk.
  const absence = await absenceNotes({ client, home, listing, refused, vanished: tally.vanished });
  return {
    ...base,
    notes: [
      `${String(listing.directories.length)} authored director(ies), ${String(tally.bytes)} byte(s) read`,
      `${String(tally.binary)} binary file(s) scanned as raw bytes, ${String(tally.bundles)} of them git bundles also scanned object by object — a secret inside an image's compressed data is not seen`,
      ...retention.notes,
      ...mirrored,
      ...unclassifiedNotes({ unclassified: listing.unclassified }),
      ...vanishedListedFileNotes({ paths: tally.vanished }),
      ...absence,
    ],
    projected: tally.projected,
    refused,
    written: retention.written + written,
  };
}
