/**
 * The Outlook mailbox's folders: the visible hierarchy, and turning what the owner typed — a well-known name,
 * a display name, or an id — into exactly one folder.
 *
 * Display names are values, not identifiers: two folders may share one at different depths, so a name that
 * matches more than one folder is refused naming each id, never resolved to the first. A well-known name
 * (`inbox`, `archive`, …) is asked of Graph directly, because Graph resolves it and the display name a user
 * sees for the same folder is localised.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi, PageStart } from "./apiCore.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import type { GraphMailFolder } from "./graphWire.js";

/** One folder as the verbs print it. */
export interface OutlookFolder {
  readonly id: string;
  readonly displayName: string;
  readonly parentFolderId: string | null;
  /** The display names from the top of the hierarchy down to this folder, for a reader telling twins apart. */
  readonly path: readonly string[];
  readonly totalItemCount: number;
  readonly unreadItemCount: number;
  readonly childFolderCount: number;
}

/** The hierarchy, and whether the walk stopped before reaching all of it. */
export interface FolderWalk {
  readonly folders: readonly OutlookFolder[];
  /** True when {@link MAX_FOLDER_PAGES} was reached; the listing is then a prefix, and says so. */
  readonly truncated: boolean;
}

/** The well-known folder names Graph resolves itself — Microsoft's documented `wellKnownFolderName` set for mail. */
const WELL_KNOWN = new Set([
  "archive",
  "clutter",
  "conflicts",
  "conversationhistory",
  "deleteditems",
  "drafts",
  "inbox",
  "junkemail",
  "localfailures",
  "msgfolderroot",
  "outbox",
  "recoverableitemsdeletions",
  "scheduled",
  "searchfolders",
  "sentitems",
  "serverfailures",
  "syncissues",
]);

/** How many folder pages one walk reads before it stops and reports itself truncated. */
const MAX_FOLDER_PAGES = 50;

/**
 * Whether a reference is a well-known folder name Graph resolves itself.
 *
 * @param reference what the owner typed
 * @returns true for `inbox`, `Archive`, `sentitems` and the rest of Microsoft's set, case-insensitively
 */
export function isWellKnownFolder({ reference }: { reference: string }): boolean {
  return WELL_KNOWN.has(reference.toLowerCase());
}

/**
 * One wire folder as the verbs print it, refusing an answer missing a field the `$select` asked for.
 *
 * @param path the display names above this folder
 * @returns the folder, or the missing field
 */
export function toOutlookFolder({
  folder,
  path,
}: {
  folder: GraphMailFolder;
  path: readonly string[];
}): Result<OutlookFolder, OutlookError> {
  const operation = "outlook.folders.list";
  const { displayName, totalItemCount, unreadItemCount, childFolderCount } = folder;
  if (displayName == null) {
    return err(OutlookErrors.responseFieldMissing({ field: "displayName", operation }));
  }
  if (totalItemCount === undefined || unreadItemCount === undefined || childFolderCount === undefined) {
    return err(OutlookErrors.responseFieldMissing({ field: "item counts", operation }));
  }
  return ok({
    childFolderCount,
    displayName,
    id: folder.id,
    parentFolderId: unsetFieldAsNull({ key: "parentFolderId", record: folder }),
    path: [...path, displayName],
    totalItemCount,
    unreadItemCount,
  });
}

/**
 * Walk the visible folder hierarchy breadth-first, every page of every level, up to {@link MAX_FOLDER_PAGES}.
 * Hidden folders are left out, as Outlook leaves them out.
 *
 * @param api the Outlook seam
 * @returns every visible folder with its path, or the first failure
 */
export async function walkFolders({ api }: { api: OutlookApi }): Promise<Result<FolderWalk, OutlookError>> {
  const folders: OutlookFolder[] = [];
  const queue: FolderLevel[] = [{ parentId: undefined, path: [] }];
  let pages = 0;
  for (let level = queue.shift(); level !== undefined; level = queue.shift()) {
    const walked = await walkLevel({ api, folders, level, pagesUsed: pages, queue });
    if (walked.isErr()) {
      return err(walked.error);
    }
    if (walked.value.truncated) {
      return ok({ folders, truncated: true });
    }
    pages = walked.value.pagesUsed;
  }
  return ok({ folders, truncated: false });
}

/** One level of the hierarchy still to read: the parent's id (none for the top) and its display-name path. */
interface FolderLevel {
  readonly parentId: string | undefined;
  readonly path: readonly string[];
}

/**
 * Read every page of one level, appending each visible folder and queueing each that has children. Stops at
 * {@link MAX_FOLDER_PAGES} across the whole walk, which `pagesUsed` carries in and out.
 */
async function walkLevel({
  api,
  folders,
  level,
  pagesUsed,
  queue,
}: {
  api: OutlookApi;
  folders: OutlookFolder[];
  level: FolderLevel;
  pagesUsed: number;
  queue: FolderLevel[];
}): Promise<Result<{ pagesUsed: number; truncated: boolean }, OutlookError>> {
  let pages = pagesUsed;
  let start: PageStart<{ parentId: string | undefined }> = { first: { parentId: level.parentId } };
  for (;;) {
    if (pages >= MAX_FOLDER_PAGES) {
      return ok({ pagesUsed: pages, truncated: true });
    }
    pages += 1;
    const page = await api.listFolders(start);
    if (page.isErr()) {
      return err(page.error);
    }
    const accepted = acceptFolderPage({ folders, items: page.value.items, path: level.path, queue });
    if (accepted.isErr()) {
      return err(accepted.error);
    }
    if (page.value.nextLink === undefined) {
      return ok({ pagesUsed: pages, truncated: false });
    }
    start = { link: page.value.nextLink };
  }
}

/** Append one page's visible folders under `path`, queueing each that has children; hidden ones are skipped. */
function acceptFolderPage({
  folders,
  items,
  path,
  queue,
}: {
  folders: OutlookFolder[];
  items: readonly GraphMailFolder[];
  path: readonly string[];
  queue: FolderLevel[];
}): Result<void, OutlookError> {
  for (const wire of items) {
    if (wire.isHidden === true) {
      continue;
    }
    const folder = toOutlookFolder({ folder: wire, path });
    if (folder.isErr()) {
      return err(folder.error);
    }
    folders.push(folder.value);
    if (folder.value.childFolderCount > 0) {
      queue.push({ parentId: folder.value.id, path: folder.value.path });
    }
  }
  return ok(undefined);
}

/**
 * Pick exactly one folder from a walked hierarchy by id, or by display name case-insensitively.
 *
 * @param folders the walked hierarchy
 * @param reference what the owner typed
 * @returns the one folder, or a refusal naming every candidate
 */
export function pickFolder({
  folders,
  reference,
}: {
  folders: readonly OutlookFolder[];
  reference: string;
}): Result<OutlookFolder, OutlookError> {
  const byId = folders.find((folder) => folder.id === reference);
  if (byId !== undefined) {
    return ok(byId);
  }
  const wanted = reference.toLowerCase();
  const byName = folders.filter((folder) => folder.displayName.toLowerCase() === wanted);
  const [only] = byName;
  if (only !== undefined && byName.length === 1) {
    return ok(only);
  }
  return err(
    OutlookErrors.referenceUnresolved({
      candidates: byName.map((folder) => `${folder.path.join("/")} (${folder.id})`),
      kind: "folder",
      reference,
    }),
  );
}

/**
 * Resolve what the owner typed to something a folder path segment takes: a well-known name as itself (Graph
 * accepts `inbox` wherever it accepts an id), anything else through the walked hierarchy.
 *
 * @param api the Outlook seam
 * @param reference a well-known name, a display name or an id
 * @returns the folder's id or well-known name, or why it did not resolve to exactly one
 */
export async function resolveFolderId({
  api,
  reference,
}: {
  api: OutlookApi;
  reference: string;
}): Promise<Result<string, OutlookError>> {
  if (isWellKnownFolder({ reference })) {
    return ok(reference.toLowerCase());
  }
  const walk = await walkFolders({ api });
  if (walk.isErr()) {
    return err(walk.error);
  }
  return pickFolder({ folders: walk.value.folders, reference }).map((folder) => folder.id);
}
