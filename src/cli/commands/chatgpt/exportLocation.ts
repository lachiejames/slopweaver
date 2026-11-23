/**
 * Where `chatgpt sync` takes an export in from: what `--from` names, or every export zip in Downloads. Split from
 * `exportRun.ts` so the verb reads as its own steps.
 */
import { statSync } from "node:fs";

import { type ChatgptArchiveDeps, findExportArchives } from "../../../corpus/chatgpt/archive.js";
import { resolveMemberSource } from "../../../corpus/chatgpt/exportSource.js";

/** What `--from`, or its absence, resolves to: the exports to take in, newest first, nothing found, or a refusal. */
export type ExportLocation =
  | { readonly kind: "paths"; readonly paths: readonly [string, ...string[]] }
  | { readonly kind: "none"; readonly looked: string }
  | { readonly kind: "unreadable"; readonly line: string; readonly malformed: boolean };

/** Whether a path is a folder; one that will not stat is not. */
function isFolder({ path }: { path: string }): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where to take an export in from: `--from` when it names an export, else every export zip in the folder it names,
 * else every one in Downloads, newest first.
 *
 * Only a folder is searched for zips when it is not an export itself. A file they named that is refused, or a folder
 * holding conversations files that are not one export (one part of a split export, a part missing), is refused by
 * its own reason: searched instead, it would find no zip and end as if there were nothing to take in.
 *
 * @param from what `--from` named, if anything
 * @param archive the process edges for a zip
 * @param downloadsDir where to look when `--from` names nothing
 * @returns the exports to take in, that none was found, or the refusal line to print
 */
export function locateExport({
  from,
  archive,
  downloadsDir,
}: {
  from: string | undefined;
  archive: ChatgptArchiveDeps;
  downloadsDir: string;
}): ExportLocation {
  let dir = downloadsDir;
  if (from !== undefined) {
    // Resolving members is read-only, and it is the one definition of "this is an export" the import uses too.
    const named = resolveMemberSource({ archive, from });
    if (named.isOk()) {
      return { kind: "paths", paths: [from] };
    }
    if (!isFolder({ path: from }) || named.error.code === "UNSAFE_MEMBER") {
      return {
        kind: "unreadable",
        line: `chatgpt: could not take in ${from}: ${named.error.message}`,
        malformed: true,
      };
    }
    dir = from;
  }
  const found = findExportArchives({ archive, dir });
  if (found.isErr()) {
    return {
      kind: "unreadable",
      line: `chatgpt: could not look for an export in ${dir}: ${found.error.message}`,
      malformed: found.error.code === "MALFORMED_EXPORT" || found.error.code === "UNLISTABLE_ZIP",
    };
  }
  const [newest, ...older] = found.value;
  if (newest === undefined) {
    return { kind: "none", looked: dir };
  }
  return { kind: "paths", paths: [newest, ...older] };
}
