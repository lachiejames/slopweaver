/**
 * The PURE core of `slopweaver atlas <platform> restore`: what the flags mean, and what the two outputs say.
 *
 * One verb for every registered platform rather than 36 modules, because a restore is a directory
 * transaction and `../../../atlas/kit/archive.ts` needs no platform contract to perform one. The effectful
 * half — resolving the home, moving the directories, writing to a stream — is `./restoreRun.ts`'s.
 *
 * ## Listing is the default, and choosing is never implicit
 *
 * With no `--archive` this LISTS. It never picks the newest on the operator's behalf: a restore replaces the
 * live generation, and a verb that guesses which one to install is a verb that eventually installs the wrong
 * one silently. Naming an archive additionally requires `--confirm archive-current`, which is the word for
 * what actually happens to whatever is live right now — it is archived, exactly as `reset` archives.
 */
import type { AtlasArchiveSummary, AtlasRestoreOutcome } from "../../../atlas/kit/archive.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, type ParsedFlagTail } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/** What the flag tail resolved to: list every archive, or install one. */
export type AtlasRestoreRequest =
  | { readonly mode: "list"; readonly home: string; readonly json: boolean }
  | { readonly mode: "restore"; readonly home: string; readonly json: boolean; readonly archiveId: string };

/**
 * The usage block this verb prints, exported so a test can assert it equals the manifest's own copy.
 *
 * @param platform the platform being addressed
 * @returns the usage block, ending without a trailing newline
 */
export function atlasRestoreUsage({ platform }: { platform: string }): string {
  return [
    `usage: slopweaver atlas ${platform} restore [--archive <archive-id> --confirm archive-current] [--json] [--home <dir>]`,
    `  with no --archive, lists every generation \`reset\` archived, newest first`,
    `  --archive <id>            install that archived generation as the live one`,
    `  --confirm archive-current required with --archive: the live generation is archived, never deleted`,
  ].join("\n");
}

/**
 * Decide what a restore invocation asked for.
 *
 * @param parsed the tail as `parseFlagTail` validated it
 * @param home the home to use when the tail names none
 * @returns the request, or why the tail is unusable
 */
export function atlasRestoreRequest({
  parsed,
  home,
}: {
  parsed: ParsedFlagTail;
  home: string;
}): Result<AtlasRestoreRequest, AtlasCommandError> {
  const resolvedHome = flagValueOr({ fallback: home, name: "home", parsed });
  const json = parsed.flags.has("json");
  const archiveId = parsed.values["archive"];
  const confirm = parsed.values["confirm"];
  if (archiveId === undefined) {
    if (confirm !== undefined) {
      return err(AtlasCommandErrors.restoreConfirmWithoutArchive());
    }
    return ok({ home: resolvedHome, json, mode: "list" });
  }
  if (confirm !== "archive-current") {
    if (confirm === undefined) {
      return err(AtlasCommandErrors.restoreConfirmRequired());
    }
    return err(AtlasCommandErrors.confirmMismatch({ confirm, expected: "archive-current" }));
  }
  return ok({ archiveId, home: resolvedHome, json, mode: "restore" });
}

/**
 * The human listing: one line per archive, plus what to type to install one.
 *
 * An archive whose manifest could not be read still gets a line, carrying `unreadable` where its numbers
 * would go — hiding it would make a generation that exists on disk invisible to the only verb that can
 * reach it, which is the failure this whole verb was written for.
 *
 * @param platform the platform being addressed
 * @param archives every archive, newest first
 * @returns the lines to print, in order
 */
export function atlasRestoreListLines({
  platform,
  archives,
}: {
  platform: string;
  archives: readonly AtlasArchiveSummary[];
}): readonly string[] {
  if (archives.length === 0) {
    return [`no archived ${platform} generation — \`atlas ${platform} reset --confirm archive\` is what creates one`];
  }
  const rows = archives.map((archive) => `  ${archive.archiveId}  ${archiveCounted({ archive })}`);
  return [
    `${String(archives.length)} archived ${platform} generation(s), newest first:`,
    ...rows,
    "",
    `restore one: slopweaver atlas ${platform} restore --archive <archive-id> --confirm archive-current`,
  ];
}

/**
 * What one archive says about itself. Its schema, entity count and clock all come off the one manifest header,
 * so a manifest that could not be read leaves all three unknown — and the row says so rather than printing a
 * zero count or a missing clock as though the header had been read.
 */
function archiveCounted({ archive }: { archive: AtlasArchiveSummary }): string {
  const { schemaVersion, entityCount, updatedAt } = archive;
  if (schemaVersion === null || entityCount === null || updatedAt === null) {
    return "unreadable";
  }
  return `schema ${String(schemaVersion)} · ${String(entityCount)} entities · ${updatedAt}`;
}

/**
 * What a completed restore prints, including the exact command that undoes it.
 *
 * @param platform the platform being addressed
 * @param archiveId the archive that was installed
 * @param outcome what the kit moved
 * @returns the lines to print, in order
 */
export function atlasRestoreDoneLines({
  platform,
  archiveId,
  outcome,
}: {
  platform: string;
  archiveId: string;
  outcome: AtlasRestoreOutcome;
}): readonly string[] {
  const lines = [`${platform} atlas restored from ${archiveId} — now the live generation`];
  if (outcome.archivedCurrentTo !== null) {
    lines.push(`the generation that was live is archived at ${outcome.archivedCurrentTo}`);
  }
  if (outcome.undoArchiveId !== null) {
    lines.push(
      `undo: slopweaver atlas ${platform} restore --archive ${outcome.undoArchiveId} --confirm archive-current`,
    );
  }
  return lines;
}
