/**
 * `slopweaver briefing archive --form <path>` — move a form's oldest folded notes and history sections into
 * a dated archive file beside it, and rewrite the form in place, so it fits `SECTION_MAX_NOTES` and
 * `HISTORY_MAX_SECTIONS` again (`skills/supervisor/reference/fleet-briefing-shape.md`). The form is read
 * newest-first, the order `briefing sweep-block` writes; `--oldest-first` is for a form that appends.
 *
 * This is the remedy the schema's refusal names. The pure trim is `src/briefing/archive.ts`; this edge only
 * reads the file, writes two files, and says what moved. Nothing is deleted: the archive file holds every
 * note that left the form, with the instant and the form path it came from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { archiveBriefingForm, archiveDocument } from "../../../briefing/archive.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseBriefingArchiveArgs } from "./archiveArgs.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { briefingCommandErrorLines } from "./errors.js";
import { BRIEFING_ARCHIVE_USAGE } from "./usage.js";

/** Everything `briefing archive` touches outside itself, injected so a test drives the whole verb. */
export interface BriefingArchiveDeps {
  /** Reads the form file, or throws. */
  readonly readFile: (args: { path: string }) => string;
  /** Writes one file. */
  readonly writeFile: (args: { path: string; text: string }) => void;
  /** The instant this pass ran, for the archive file's name and stamp. */
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The archive file's default path: beside the form, named for the instant, filesystem-safe.
 *
 * @param formPath the form being trimmed
 * @param nowIso the instant
 * @returns `<form dir>/briefing-archive-<instant>.json`
 */
export function defaultArchivePath({ formPath, nowIso }: { formPath: string; nowIso: string }): string {
  return join(dirname(formPath), `briefing-archive-${nowIso.replace(/[:.]/g, "-")}.json`);
}

/** Where this pass writes the archive: `--out` when given, else {@link defaultArchivePath} beside the form. */
function archivePathFor({
  out,
  formPath,
  nowIso,
}: {
  out: string | undefined;
  formPath: string;
  nowIso: string;
}): string {
  if (out === undefined) {
    return defaultArchivePath({ formPath, nowIso });
  }
  return out;
}

/**
 * Run `briefing archive` against injected seams.
 *
 * @param rest the argv tail after `briefing archive`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runBriefingArchive({ rest, deps }: { rest: readonly string[]; deps: BriefingArchiveDeps }): number {
  const args = parseBriefingArchiveArgs({ rest });
  if (args.isErr()) {
    for (const line of briefingCommandErrorLines({ error: args.error })) {
      deps.writeDiagnostic(`briefing archive: ${line}`);
    }
    deps.writeDiagnostic(BRIEFING_ARCHIVE_USAGE);
    return EXIT_USAGE;
  }
  const { formPath, keepNotes, keepSections, oldestFirst, out, dryRun } = args.value;
  let form: unknown;
  try {
    form = JSON.parse(deps.readFile({ path: formPath }));
  } catch (error: unknown) {
    deps.writeDiagnostic(
      `briefing archive: ${formPath}: could not read the form — ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return EXIT_ERROR;
  }
  const archive = archiveBriefingForm({ form, keepNotes, keepSections, oldestFirst });
  const moved = archive.earlierNotes.length + archive.historySections.length;
  if (moved === 0) {
    deps.writeOut(
      `briefing archive: nothing over the caps (${String(keepNotes)} notes, ${String(keepSections)} sections); ${formPath} is unchanged`,
    );
    return EXIT_OK;
  }
  const nowIso = deps.now();
  const archivePath = archivePathFor({ formPath, nowIso, out });
  const report =
    `briefing archive: ${String(archive.earlierNotes.length)} earlierToday note(s) and ` +
    `${String(archive.historySections.length)} history section(s) ${dryRun ? "would move" : "moved"} to ${archivePath}`;
  if (dryRun) {
    deps.writeOut(`${report} (dry run, nothing written)`);
    return EXIT_OK;
  }
  deps.writeFile({
    path: archivePath,
    text: `${JSON.stringify(archiveDocument({ archive, archivedAtIso: nowIso, formPath }), null, 2)}\n`,
  });
  deps.writeFile({ path: formPath, text: `${JSON.stringify(archive.form, null, 2)}\n` });
  deps.writeOut(report);
  return EXIT_OK;
}

/**
 * The real seams: the filesystem and the clock.
 *
 * @returns the production dependencies for {@link runBriefingArchive}
 */
export function productionBriefingArchiveDeps(): BriefingArchiveDeps {
  return {
    now: () => new Date().toISOString(),
    readFile: ({ path }) => readFileSync(path, "utf8"),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeFile: ({ path, text }) => {
      writeFileSync(path, text, "utf8");
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver briefing archive`. */
export const briefingArchiveCommand = defineCommand({
  run: (argv) => runBriefingArchive({ deps: productionBriefingArchiveDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
