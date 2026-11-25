/**
 * The `outlook` source's read plan — which folders a pass reads, and where each one's round starts.
 *
 * ## Every visible folder, bar four whole trees
 *
 * History is the mail the owner has, filed wherever they filed it, so every visible folder is read
 * (`../../live/outlook/folders.ts`'s walk, which leaves hidden ones out as Outlook does). Four trees are not
 * mail the owner has: Drafts is unsent and rewritten on every keystroke, Outbox is in flight, Junk Email is
 * what the owner never wanted, and Deleted Items is what the owner threw away. Each is excluded WITH every
 * folder under it, because a user-made subfolder of Deleted Items is still deleted mail.
 *
 * ## What exclusion cannot promise
 *
 * The excluded trees are judged from ONE folder walk at the start of the pass, and each folder is read after
 * it. A folder moved beneath Deleted Items (or Junk) between the walk and its own round is still read on THIS
 * pass; the next pass's walk sees it under the excluded root and leaves it out. Bronze is append-only, so
 * anything read before a move or a deletion stays in the corpus either way — the same residue as a message
 * deleted after it was read (`./folderDelta.ts`). Re-walking per folder narrows the window without closing
 * it, since a move can land mid-round, so the walk is taken once and the residue stated instead.
 *
 * ## Whole the first time, then by delta link
 *
 * A folder with no stored link is read from an initial delta round, which enumerates the folder whole; one
 * with a link resumes from it. An explicit `--since`/`--all` ignores every link and reads each folder whole:
 * a delta round has no time-bounded equivalent, so the whole folder is the only honest reading of a named
 * window. What an initial round covers is the folder as it stands NOW — mail deleted before it is not history
 * this source can recover.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi, PageStart } from "../../live/outlook/apiCore.js";
import type { OutlookError } from "../../live/outlook/errors.js";
import { type OutlookFolder, walkFolders } from "../../live/outlook/folders.js";
import type { OutlookMailSyncAnchors } from "./syncAnchor.js";

/** The well-known folders whose whole trees are never read — this file's header says why each. */
const EXCLUDED_WELL_KNOWN: readonly string[] = ["drafts", "outbox", "junkemail", "deleteditems"];

/** A caller's deliberate read bound, from `--sample`/`--fetch-cap`. */
export interface OutlookMailReadCap {
  /** The most message records taken from any one folder. */
  readonly maxMessages: number;
}

/** The folders one pass reads, and what the discovery itself could not cover. */
export interface OutlookMailFolderDiscovery {
  readonly folders: readonly OutlookFolder[];
  /** How many visible folders were left out as part of an excluded tree. */
  readonly excluded: number;
  /** True when the folder walk hit its page ceiling, so some folders were never seen. */
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

/**
 * The read bound a `--sample`/`--fetch-cap` run puts on this lane: the tighter of the two, per folder. Pure.
 *
 * @param sample the `--sample` cap, when set
 * @param fetchCap the `--fetch-cap` cap, when set
 * @returns the cap to apply, or undefined for an unbounded run
 */
export function outlookMailReadCap({
  sample,
  fetchCap,
}: {
  sample: number | undefined;
  fetchCap: number | undefined;
}): OutlookMailReadCap | undefined {
  const bounds = [sample, fetchCap].filter((value): value is number => value !== undefined);
  if (bounds.length === 0) {
    return undefined;
  }
  return { maxMessages: Math.min(...bounds) };
}

/**
 * Every folder id inside an excluded tree: the roots, and every folder whose parent is already in. Iterated to
 * a fixed point, so the answer does not depend on the order the walk listed them. Pure.
 *
 * @param folders the walked hierarchy
 * @param roots the excluded roots' ids
 * @returns every excluded folder id
 */
export function excludedTree({
  folders,
  roots,
}: {
  folders: readonly OutlookFolder[];
  roots: ReadonlySet<string>;
}): ReadonlySet<string> {
  const excluded = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (!excluded.has(folder.id) && folder.parentFolderId !== null && excluded.has(folder.parentFolderId)) {
        excluded.add(folder.id);
        grew = true;
      }
    }
  }
  return excluded;
}

/**
 * The walk's folders with each id kept once, at its first appearance. A hierarchy that changes while the walk
 * pages through it can list one folder twice, and a folder read twice is read twice over — its round, its
 * one restart allowance and its link write all doubled. Pure.
 *
 * @param folders the walked hierarchy, possibly listing an id more than once
 * @returns each folder once, in walk order
 */
export function firstOfEachFolder({ folders }: { folders: readonly OutlookFolder[] }): readonly OutlookFolder[] {
  const seen = new Set<string>();
  return folders.filter((folder) => {
    if (seen.has(folder.id)) {
      return false;
    }
    seen.add(folder.id);
    return true;
  });
}

/**
 * Walk the mailbox and drop the excluded trees. A well-known folder this mailbox does not have is a note; any
 * other failure to resolve one fails discovery, because reading with an exclusion missing would ingest junk or
 * deleted mail.
 *
 * @param api the Outlook seam
 * @returns the folders to read, or the failure that stopped discovery
 */
export async function discoverOutlookMailFolders({
  api,
}: {
  api: OutlookApi;
}): Promise<Result<OutlookMailFolderDiscovery, OutlookError>> {
  const roots = new Set<string>();
  const notes: string[] = [];
  for (const reference of EXCLUDED_WELL_KNOWN) {
    const folder = await api.getFolder({ reference });
    if (folder.isErr()) {
      if (folder.error.code !== "REFERENCE_UNRESOLVED") {
        return err(folder.error);
      }
      notes.push(`this mailbox has no ${reference} folder, so there is nothing of it to leave out`);
      continue;
    }
    roots.add(folder.value.id);
  }
  const walk = await walkFolders({ api });
  if (walk.isErr()) {
    return err(walk.error);
  }
  const distinct = firstOfEachFolder({ folders: walk.value.folders });
  const excluded = excludedTree({ folders: distinct, roots });
  const folders = distinct.filter((folder) => !excluded.has(folder.id));
  return ok({
    excluded: distinct.length - folders.length,
    folders,
    notes,
    truncated: walk.value.truncated,
  });
}

/**
 * Where one folder's round starts: its stored delta link, or an initial round. Pure.
 *
 * @param anchors every stored anchor
 * @param folderId the folder being read
 * @param cursorOverridden whether the caller named an explicit window, which reads the folder whole
 * @returns the start to request
 */
export function deltaStartFor({
  anchors,
  folderId,
  cursorOverridden,
}: {
  anchors: OutlookMailSyncAnchors;
  folderId: string;
  cursorOverridden: boolean;
}): PageStart<{ readonly folderId: string }> {
  const anchor = anchors[folderId];
  if (cursorOverridden || anchor === undefined) {
    return { first: { folderId } };
  }
  return { link: anchor.deltaLink };
}
