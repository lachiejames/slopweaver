/**
 * Where an export's conversations files are read from when one is taken in: a zip, an unzipped export directory, or
 * one conversations file — and the copy of one member into an import's staging directory.
 *
 * Which members count is `archive.ts`'s ({@link selectConversationMembers}); this file only lists names and copies.
 */
import {
  chmodSync,
  constants,
  copyFileSync,
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  statfsSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptArchiveDeps, type ConversationMember, isZipFile, selectConversationMembers } from "./archive.js";
import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";

/** Where the members come from: a zip, or files on disk. */
export type MemberSource =
  | { readonly kind: "zip"; readonly zipPath: string; readonly members: readonly ConversationMember[] }
  | { readonly kind: "files"; readonly root: string; readonly members: readonly ConversationMember[] };

/** More entries than any one export holds; a tree past it is a folder of other things, not an export. */
const MAX_DIRECTORY_ENTRIES = 200_000;

/**
 * Every path under a directory, at every depth, relative to it — the same whole listing a zip's central directory
 * gives, so the selector judges a folder exactly as it judges the archive it was unzipped from. A conversations file
 * three folders down is SEEN, and refused there as a candidate no export places, rather than missed while the files
 * beside it are read as the whole export.
 *
 * Fails closed: a folder that will not list may hold a conversations file, so it refuses the directory rather than
 * reading the rest as complete. A link to a folder is listed and never followed (a `Dirent` is the link itself).
 */
function directoryNames({ dir }: { dir: string }): Result<readonly string[], ChatgptExportError> {
  const names: string[] = [];
  const pending: string[] = [""];
  let seen = 0;
  for (let relative = pending.pop(); relative !== undefined; relative = pending.pop()) {
    const listed = listFolder({ dir, relative });
    if (listed.isErr()) {
      return err(listed.error);
    }
    seen += listed.value.files.length + listed.value.folders.length;
    if (seen > MAX_DIRECTORY_ENTRIES) {
      const detail = `holds more than ${String(MAX_DIRECTORY_ENTRIES)} entries, so it is not one export`;
      return err(ChatgptExportErrors.archiveUnreadable({ detail, path: dir }));
    }
    for (const file of listed.value.files) {
      names.push(file);
    }
    for (const folder of listed.value.folders) {
      pending.push(folder);
    }
  }
  return ok(names);
}

/** One folder's entries as paths relative to the walk's root: the folders to descend into, and everything else. */
function listFolder({
  dir,
  relative,
}: {
  dir: string;
  relative: string;
}): Result<{ files: readonly string[]; folders: readonly string[] }, ChatgptExportError> {
  const at = relative === "" ? dir : join(dir, relative);
  let entries: Dirent[];
  try {
    entries = readdirSync(at, { withFileTypes: true });
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: at }));
  }
  const files: string[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    const name = relative === "" ? entry.name : `${relative}/${entry.name}`;
    (entry.isDirectory() ? folders : files).push(name);
  }
  return ok({ files, folders });
}

/**
 * Resolve what `--from` names into the members to take in.
 *
 * @param from a zip, an unzipped export directory, or one conversations file
 * @param archive the process edges for a zip
 * @returns where to read each member from, or why `from` is not an export
 */
export function resolveMemberSource({
  from,
  archive,
}: {
  from: string;
  archive: ChatgptArchiveDeps;
}): Result<MemberSource, ChatgptExportError> {
  if (!existsSync(from)) {
    return err(ChatgptExportErrors.exportPathMissing({ path: from }));
  }
  if (statSync(from).isDirectory()) {
    return directoryNames({ dir: from })
      .andThen((names) => selectConversationMembers({ names, path: from }))
      .map((members) => ({ kind: "files" as const, members, root: from }));
  }
  if (isZipFile({ path: from })) {
    return archive
      .listZip({ zipPath: from })
      .andThen((names) => selectConversationMembers({ names, path: from }))
      .map((members) => ({ kind: "zip" as const, members, zipPath: from }));
  }
  return namedFileSource({ from });
}

/**
 * One conversations file the owner named, taken alone only when it IS the whole export: a numbered one must be file 0, and
 * no other conversations file may sit beside it, since naming one part of a split export would read and receipt that
 * part while the rest went unread.
 */
function namedFileSource({ from }: { from: string }): Result<MemberSource, ChatgptExportError> {
  const name = basename(from);
  const root = dirname(from);
  const alone = selectConversationMembers({ names: [name], path: from });
  if (alone.isErr()) {
    return err(alone.error);
  }
  const listed = listFolder({ dir: root, relative: "" });
  if (listed.isErr()) {
    return err(listed.error);
  }
  // The folder's own files go through the same selection a listed export does, so a sibling in a shape this reader
  // does not know is refused by it, never passed over.
  const beside = selectConversationMembers({ names: listed.value.files, path: root });
  if (beside.isErr()) {
    return err(beside.error);
  }
  const sibling = beside.value.find((member) => member.member !== name)?.member;
  if (sibling !== undefined) {
    const why = `a conversations file beside ${name}, so naming one file would leave the rest unread — name the folder`;
    return err(ChatgptExportErrors.unsafeMember({ member: sibling, why }));
  }
  return ok({ kind: "files" as const, members: alone.value, root });
}

/**
 * When the owner came by this export — never when Slopweaver copied it, which is any time after and would make a months-old
 * archive taken in today read as today's. A zip dates from its own file's modified time (when it was downloaded); a
 * conversations file, or an unzipped folder, from the newest of its members' (`unzip` restores the times the export
 * stored, so a folder dates from when ChatGPT wrote it). Never later than `nowIso`: a file dated in the future dates
 * nothing beyond the moment it was seen.
 *
 * @param source where the members are read from
 * @param nowIso the instant of the take-in, the latest this answers
 * @returns the instant, or why a file it dates from would not stat
 */
export function acquiredAtIso({
  source,
  nowIso,
}: {
  source: MemberSource;
  nowIso: string;
}): Result<string, ChatgptExportError> {
  const paths =
    source.kind === "zip" ? [source.zipPath] : source.members.map((member) => join(source.root, member.member));
  let latest: string | undefined;
  for (const path of paths) {
    let modified: string;
    try {
      modified = statSync(path).mtime.toISOString();
    } catch (cause) {
      return err(ChatgptExportErrors.exportStoreFailed({ cause, path }));
    }
    if (latest === undefined || modified > latest) {
      latest = modified;
    }
  }
  // `selectConversationMembers` refuses an empty set, so there is always at least one path.
  return ok(latest! < nowIso ? latest! : nowIso);
}

/**
 * The most bytes one export's conversations files may take on disk while it is taken in. A ceiling CHOSEN, not
 * measured: no real export has been read here yet (the committed fixture is kilobytes), so it is set far past any
 * history a person types, while still stopping a crafted zip in Downloads long before it fills a disk.
 */
const MAX_EXPORT_BYTES = 8 * 1024 ** 3;

/** Free space a take-in always leaves on the disk, so the owner's machine is never run out of room by an import. */
const FREE_SPACE_RESERVE_BYTES = 2 * 1024 ** 3;

/**
 * The bytes one take-in may write: the export ceiling, or the disk's free space less the reserve, whichever is less.
 * Pure.
 *
 * @param freeBytes the bytes free to an unprivileged writer on the staging directory's disk
 * @returns the budget, never below zero
 */
export function exportBudgetBytes({ freeBytes }: { freeBytes: number }): number {
  return Math.max(0, Math.min(MAX_EXPORT_BYTES, freeBytes - FREE_SPACE_RESERVE_BYTES));
}

/**
 * The budget for a take-in staged in `dir`, read off its disk.
 *
 * @param dir the staging directory
 * @returns the bytes it may write, or why the disk would not report its free space
 */
export function stagingBudgetBytes({ dir }: { dir: string }): Result<number, ChatgptExportError> {
  try {
    const disk = statfsSync(dir);
    return ok(exportBudgetBytes({ freeBytes: disk.bavail * disk.bsize }));
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: dir }));
  }
}

/**
 * Copy one member into the staging directory as a `0600` file, refused rather than written past `maxBytes`.
 *
 * @param source where the member is read from
 * @param member the member to copy
 * @param toPath its path inside the staging directory, which must not exist yet
 * @param archive the process edges for a zip
 * @param maxBytes what is left of the take-in's budget
 * @returns nothing, or why the member could not be copied
 */
export function stageMember({
  source,
  member,
  toPath,
  archive,
  maxBytes,
}: {
  source: MemberSource;
  member: ConversationMember;
  toPath: string;
  archive: ChatgptArchiveDeps;
  maxBytes: number;
}): Result<void, ChatgptExportError> {
  if (source.kind === "zip") {
    return archive.extractZipMember({ maxBytes, member: member.member, toPath, zipPath: source.zipPath });
  }
  const from = join(source.root, member.member);
  try {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) {
      return err(ChatgptExportErrors.unsafeMember({ member: member.member, why: "a symbolic link" }));
    }
    if (stat.size > maxBytes) {
      return err(ChatgptExportErrors.exportTooLarge({ limitBytes: maxBytes, path: from }));
    }
    copyFileSync(from, toPath, constants.COPYFILE_EXCL);
    chmodSync(toPath, 0o600);
    // The source can change between that stat and the copy, so the bound is held to what was actually written.
    if (statSync(toPath).size > maxBytes) {
      return err(ChatgptExportErrors.exportTooLarge({ limitBytes: maxBytes, path: from }));
    }
    return ok(undefined);
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: toPath }));
  }
}
