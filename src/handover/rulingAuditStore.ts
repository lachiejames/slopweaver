/**
 * Acquire everything `handover audit-rulings` accounts for: the active board, its archive, every journal
 * under `runs/`, and the manifest when one is named.
 *
 * ## Why the audit enumerates for itself
 *
 * No existing reader covers the set. `scanBoard` deliberately never reads `archive/` — that boundary is what
 * keeps closed work off the board, and it stays — while one of the rulings the backfill exists for sits on an
 * archived row. `lookupArchivedDoc` answers `undefined` for missing, unreadable and wrong-slug alike, which is
 * right for a dependency lookup and useless to an audit that has to say WHICH. And a journal whose row
 * document is gone still holds rulings. So this is the union of four sources, each scanned independently, so
 * one that fails cannot take the others' evidence with it.
 *
 * **Every failure is kept.** A directory that would not list, a doc the scan could not read, a journal named
 * for no possible row, a manifest that would not open: each becomes a typed problem, and the report is
 * incomplete while any exists. A missing directory is not a failure — a fresh home has no archive — which is
 * `scanBoard`'s own rule, applied to `runs/` too.
 *
 * Journals are read through `readRunJournal`, the one reader this register has; this module adds no second
 * way to read one.
 *
 * **The scan is one level deep in each directory, and that is the register's own shape rather than a
 * shortcut.** A row is `handovers/<slug>.md`, `handovers/archive/<slug>.md` or `runs/<slug>.jsonl`; nothing
 * in this repository reads a document nested deeper — `scanBoard` filters immediate children and
 * `lookupArchivedDoc` builds one exact path. So a subdirectory under either is not a row that went unread,
 * and reporting it as incomplete input would make the audit incomplete about files that are not rows. A
 * review pass proposed the opposite; this is the deliberate answer to it.
 */

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { absentAsEmpty } from "#lib/absent.js";
import type { IngestError } from "#lib/ingestError.js";
import { safeFs } from "#lib/safeBoundary.js";
import { type RulingAuditProblem, RulingAuditProblems } from "./rulingAuditErrors.js";
import type {
  RulingAuditDocOccurrence,
  RulingAuditInput,
  RulingAuditJournal,
  RulingAuditLocation,
} from "./rulingAuditTypes.js";
import { parseRulingManifest, type RulingManifest } from "./rulingManifest.js";
import { rulingManifestErrorLines } from "./rulingManifestErrors.js";
import { isSafeSlug, readRunJournal, runJournalPath } from "./runStore.js";
import { scanBoard } from "./store.js";

/** The suffix every run journal carries. */
const JOURNAL_SUFFIX = ".jsonl";

/** The largest manifest this will read. A reviewed list of rulings is small; anything vastly bigger is not one. */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

/**
 * The manifest path the report's scope names. An audit run without `--manifest` checks the board against no
 * reviewed list at all, and the report records that it was given none as `null`.
 */
function scopedManifestPath({ manifestPath }: { manifestPath: string | undefined }): string | null {
  if (manifestPath === undefined) {
    return null;
  }
  return manifestPath;
}

/**
 * Read every input the audit needs.
 *
 * @param handoverDir the board's directory; its `archive/` is scanned beside it
 * @param runsDir the directory holding every row's journal
 * @param manifestPath the manifest to check rows against, when one was named
 * @returns the acquired input, with every failure to acquire part of it as a problem
 */
export function readRulingAuditInput({
  handoverDir,
  manifestPath,
  runsDir,
}: {
  handoverDir: string;
  manifestPath: string | undefined;
  runsDir: string;
}): RulingAuditInput {
  const active = scanDocs({ dir: handoverDir, location: "active" });
  const archive = scanDocs({ dir: join(handoverDir, "archive"), location: "archive" });
  const journals = journalSlugs({ runsDir });
  const manifest = manifestPath === undefined ? { manifest: null, problems: [] } : readManifest({ manifestPath });
  const occurrences = [...active.occurrences, ...archive.occurrences];
  const slugs = new Set([
    ...occurrences.map((occurrence) => occurrence.doc.slug),
    ...journals.slugs,
    ...absentAsEmpty({ value: manifest.manifest?.entries }).map((entry) => entry.slug),
  ]);
  return {
    handoverDir,
    manifest: manifest.manifest,
    manifestPath: scopedManifestPath({ manifestPath }),
    problems: [...active.problems, ...archive.problems, ...journals.problems, ...manifest.problems],
    rows: [...slugs].toSorted().map((slug) => ({
      docs: occurrences.filter((occurrence) => occurrence.doc.slug === slug),
      journal: readJournal({ listed: journals.slugs.includes(slug), runsDir, slug }),
      journalPath: runJournalPath({ runsDir, slug }),
      slug,
    })),
    runsDir,
  };
}

/** Every doc one directory holds, and every file in it the scan could not read. */
function scanDocs({ dir, location }: { dir: string; location: RulingAuditLocation }): {
  readonly occurrences: readonly RulingAuditDocOccurrence[];
  readonly problems: readonly RulingAuditProblem[];
} {
  const unreadable = directoryProblem({ path: dir });
  if (unreadable !== undefined) {
    return { occurrences: [], problems: [unreadable] };
  }
  const scan = scanBoard({ handoverDir: dir });
  if (scan.isErr()) {
    return {
      occurrences: [],
      problems: [RulingAuditProblems.directoryUnreadable({ cause: scan.error.message, path: dir })],
    };
  }
  return {
    occurrences: scan.value.docs.map((doc) => ({ doc, location, path: doc.path })),
    problems: scan.value.unreadable.map((name) => RulingAuditProblems.docUnreadable({ path: join(dir, name) })),
  };
}

/** Whether a filesystem failure is the directory simply not existing yet. */
function isMissing({ error }: { error: IngestError }): boolean {
  return error.code === "ENOENT";
}

/**
 * Why a directory this audit has to read cannot be read — `undefined` when it is a readable directory, and
 * when it is simply not there.
 *
 * **A path that is not there and a path that is there and broken both raise `ENOENT`, and they mean opposite
 * things.** Found by two review passes with the same counterexample in two places: a dangling symlink at
 * `handovers/archive` or at `runs/` makes `readdirSync` raise `ENOENT`, which every reader in this register
 * rightly treats as a fresh home that has not made the directory yet — so a whole directory of rows silently
 * became an empty one, and the audit called that complete. `lstatSync` is what separates them, because it
 * does not follow the link: absent means absent, and anything else that will not list is a failure.
 */
function directoryProblem({ path }: { path: string }): RulingAuditProblem | undefined {
  const link = safeFs({ execute: () => lstatSync(path), operation: "handover.auditRulings.directory", path });
  if (link.isErr()) {
    return isMissing({ error: link.error })
      ? undefined
      : RulingAuditProblems.directoryUnreadable({ cause: link.error.message, path });
  }
  const target = safeFs({ execute: () => statSync(path), operation: "handover.auditRulings.directory", path });
  if (target.isErr()) {
    return RulingAuditProblems.directoryUnreadable({ cause: target.error.message, path });
  }
  return target.value.isDirectory()
    ? undefined
    : RulingAuditProblems.directoryUnreadable({ cause: "it is not a directory", path });
}

/** Every slug `runs/` holds a journal for, and every journal filename no row could have. */
function journalSlugs({ runsDir }: { runsDir: string }): {
  readonly slugs: readonly string[];
  readonly problems: readonly RulingAuditProblem[];
} {
  const unreadable = directoryProblem({ path: runsDir });
  if (unreadable !== undefined) {
    return { problems: [unreadable], slugs: [] };
  }
  const listed = safeFs({
    execute: () => readdirSync(runsDir),
    operation: "handover.auditRulings.runs",
    path: runsDir,
  });
  if (listed.isErr()) {
    return isMissing({ error: listed.error })
      ? { problems: [], slugs: [] }
      : {
          problems: [RulingAuditProblems.directoryUnreadable({ cause: listed.error.message, path: runsDir })],
          slugs: [],
        };
  }
  const slugs: string[] = [];
  const problems: RulingAuditProblem[] = [];
  for (const name of listed.value.filter((entry) => entry.endsWith(JOURNAL_SUFFIX)).toSorted()) {
    const slug = name.slice(0, -JOURNAL_SUFFIX.length);
    if (isSafeSlug({ slug })) {
      slugs.push(slug);
    } else {
      problems.push(RulingAuditProblems.unsafeJournalName({ path: join(runsDir, name) }));
    }
  }
  return { problems, slugs };
}

/**
 * One row's journal, decoded, or why it could not be.
 *
 * A row with no journal file at all has an empty one — most rows on the board were never run. But a name the
 * runs directory just LISTED and `statSync` then cannot resolve is a failure, not an emptiness: found by a
 * review pass, whose counterexample was a dangling symlink at `<slug>.jsonl`, which `readRunJournal` maps to
 * the same `ENOENT` a never-run row produces. So the two cases are told apart here, where the listing is
 * known, rather than inside the shared reader, which is right to treat `ENOENT` as empty.
 */
function readJournal({
  listed,
  runsDir,
  slug,
}: {
  listed: boolean;
  runsDir: string;
  slug: string;
}): RulingAuditJournal {
  const journalPath = runJournalPath({ runsDir, slug });
  if (listed) {
    const stat = safeFs({
      execute: () => statSync(journalPath),
      operation: "handover.auditRulings.journal",
      path: journalPath,
    });
    if (stat.isErr()) {
      return { cause: stat.error.message, kind: "failed" };
    }
    if (!stat.value.isFile()) {
      return { cause: `${journalPath} is not a regular file`, kind: "failed" };
    }
  }
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr()) {
    return { cause: read.error.message, kind: "failed" };
  }
  return { events: read.value.events, kind: "read", unreadableLines: read.value.unreadable };
}

/**
 * The manifest, or the problem that stopped it being read.
 *
 * A regular file of a sane size is required before it is opened, for the reason `store.ts` gives for docs: a
 * FIFO at that path would block the read forever.
 */
function readManifest({ manifestPath }: { manifestPath: string }): {
  readonly manifest: RulingManifest | null;
  readonly problems: readonly RulingAuditProblem[];
} {
  const text = safeFs({
    execute: (): string => {
      const stat = statSync(manifestPath);
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
        throw new Error(`not a regular file under ${String(MAX_MANIFEST_BYTES)} bytes`);
      }
      return readFileSync(manifestPath, "utf8");
    },
    operation: "handover.auditRulings.manifest",
    path: manifestPath,
  });
  if (text.isErr()) {
    return {
      manifest: null,
      problems: [RulingAuditProblems.manifestUnreadable({ cause: text.error.message, path: manifestPath })],
    };
  }
  const parsed = parseRulingManifest({ text: text.value });
  if (parsed.isErr()) {
    return {
      manifest: null,
      problems: [
        RulingAuditProblems.manifestInvalid({
          issues: rulingManifestErrorLines({ error: parsed.error }),
          path: manifestPath,
        }),
      ],
    };
  }
  return { manifest: parsed.value, problems: [] };
}
