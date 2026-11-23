/**
 * How new a ChatGPT export is, and how current the corpus's ChatGPT is.
 *
 * **Which export is newer is read from its content, never from when it reached this machine.** The official export
 * carries no generation stamp, so the newest instant on any conversation in it (`update_time`, else `create_time`)
 * is its chronology: a later snapshot of one account holds every activity an earlier one does, and more. An older
 * export saved, copied or named with `--from` after a newer one therefore stays older — it never becomes the export
 * a refresh treats as newest, and its file's time never renews the freshness clock. Import time only breaks a tie.
 *
 * **How current the corpus is** is when the newest export reached this machine, or a later download of that same
 * export: the act of exporting is the owner's, and its file is the only local sign of it (`currentAsOfIso`).
 */
import { epochSecondsToIso } from "#lib/date.js";
import { readJsonArrayElements } from "#lib/jsonArrayFile.js";
import { safeJsonParse } from "#lib/safeJson.js";

import type { StoredExport } from "./exportStore.js";

/** One archive a sync pass took in: which held export it turned out to be, and when its file was last written. */
export interface SeenArchive {
  readonly contentHash: string;
  readonly modifiedIso: string;
}

/** One conversation element's newest instant in epoch seconds, or `undefined` when it carries none it can read. */
function elementActivity({ text, label }: { text: string; label: string }): number | undefined {
  let value: unknown;
  try {
    value = safeJsonParse({ label, text });
  } catch {
    // An element that will not parse is the ingest's to name as a gap; it dates nothing here.
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const times = [Reflect.get(value, "update_time"), Reflect.get(value, "create_time")];
  const numbers = times.filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  return numbers.length === 0 ? undefined : Math.max(...numbers);
}

/**
 * The newest instant on any conversation in an export — its chronology, read from what it holds.
 *
 * @param files the export's conversations files
 * @returns that instant, or `null` when no conversation carries one (an empty export, or one this cannot date)
 */
export function latestActivityIso({ files }: { files: readonly string[] }): string | null {
  let newest: number | undefined;
  for (const file of files) {
    // A file that is not a whole array still dates what it held before the break; the ingest refuses it by name.
    readJsonArrayElements({
      onElement: ({ text, index }) => {
        const activity = elementActivity({ label: `chatgpt chronology ${file} element ${String(index)}`, text });
        if (activity !== undefined && (newest === undefined || activity > newest)) {
          newest = activity;
        }
        return true;
      },
      path: file,
    });
  }
  if (newest === undefined) {
    return null;
  }
  const iso = epochSecondsToIso({ seconds: newest });
  if (iso === undefined) {
    return null;
  }
  return iso;
}

/**
 * The instant the corpus last matched the owner's ChatGPT: when the owner came by the newest export (`acquiredAtIso`, its file's
 * time, never the import's — an August archive first taken in in October is August's), or a later download of that
 * SAME export. A re-download with nothing new in it hashes to the export already held, so it is never a fresh import —
 * its file's own modification time is the only sign the owner exported again. Clamped to now, so a file stamped in the
 * future cannot hold the freshness window open. Pure.
 *
 * @param newest the newest held export, by its content
 * @param seen the archives this pass took in
 * @param nowIso the current instant
 * @returns the latest of those instants, no later than now
 */
export function currentAsOfIso({
  newest,
  seen,
  nowIso,
}: {
  newest: StoredExport;
  seen: readonly SeenArchive[];
  nowIso: string;
}): string {
  let latest = newest.acquiredAtIso;
  for (const archive of seen) {
    const instant = archive.modifiedIso < nowIso ? archive.modifiedIso : nowIso;
    if (archive.contentHash === newest.contentHash && instant > latest) {
      latest = instant;
    }
  }
  return latest;
}
