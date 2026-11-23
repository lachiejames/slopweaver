/**
 * The committed SYNTHETIC ChatGPT export, copied with its file times pinned. An export is dated by when the owner came by it —
 * its files' modified time (`corpus/chatgpt/exportSource.ts#acquiredAtIso`) — so a test reading the committed folder
 * directly would be dated by whenever the repository was checked out. Every copy lands under the per-file temp root.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The committed synthetic export, whose file times are the checkout's. */
const SYNTHETIC_EXPORT = join(import.meta.dirname, "fixtures/chatgpt/synthetic-export");

/** Its two conversations files, in run order. */
const MEMBERS = ["conversations-000.json", "conversations-001.json"] as const;

/**
 * A copy of the synthetic export whose files were last modified at `modifiedIso`. A time past every test clock
 * (`FUTURE`) dates the export at the test's own `nowIso`, since a file time is never believed past now.
 *
 * @param modifiedIso the instant both files are dated
 * @returns the copy's folder
 */
export function syntheticExportAt({ modifiedIso }: { modifiedIso: string }): string {
  const folder = mkdtempSync(join(tmpdir(), "chatgpt-fixture-"));
  for (const member of MEMBERS) {
    const path = join(folder, member);
    copyFileSync(join(SYNTHETIC_EXPORT, member), path);
    utimesSync(path, new Date(modifiedIso), new Date(modifiedIso));
  }
  return folder;
}

/**
 * One of the synthetic export's conversations files, copied alone into its own folder as `conversations.json`: the
 * shape of a whole one-file export. Naming one part of the split export in place is refused, since the rest of it
 * would go unread.
 *
 * @param member which of the two files to copy
 * @param modifiedIso the instant the copy is dated
 * @returns the copy's path
 */
export function syntheticFileAlone({
  member,
  modifiedIso,
}: {
  member: (typeof MEMBERS)[number];
  modifiedIso: string;
}): string {
  const path = join(mkdtempSync(join(tmpdir(), "chatgpt-alone-")), "conversations.json");
  copyFileSync(join(SYNTHETIC_EXPORT, member), path);
  utimesSync(path, new Date(modifiedIso), new Date(modifiedIso));
  return path;
}

/** A file time past every clock a test sets, so the export is dated at the test's own now. */
export const FUTURE = "2100-01-01T00:00:00.000Z";

/**
 * A readable test name as the UUID-shaped conversation id an export carries, the only shape the reader accepts — the
 * same name always the same id, so a test builds chats and names them in its assertions by one word.
 *
 * @param name the name a test calls the chat by
 * @returns the conversation id
 */
export function chatId({ name }: { name: string }): string {
  const hex = createHash("sha256").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
