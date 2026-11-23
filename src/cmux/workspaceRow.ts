/**
 * One `workspace.list` row, decoded — shared by the lossy inventory read (`./client.ts`'s `listWorkspaces`, which
 * drops a row this answers `undefined` for) and the strict one (`./strictInventory.ts`, which refuses the reply).
 */
import { isRecord } from "../lib/parsers.js";
import type { CmuxWorkspaceSummary } from "./client.js";

/**
 * A non-empty string field on a decoded reply, or `undefined` when it is absent, blank or another type.
 *
 * Empty is treated as absent because cmux reports an unset field as `null` and an emptied one as `""`, and every
 * caller means the same thing by both.
 *
 * @param value the decoded reply or entry
 * @param field the field to read
 * @returns the string, or `undefined`
 */
export function nonEmptyString({ value, field }: { value: unknown; field: string }): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value[field];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Decode one `workspace.list` entry.
 *
 * @param entry the row as cmux sent it
 * @param windowId the window whose `workspace.list` carried it
 * @returns the row, or `undefined` when it lacks an id, a ref or a directory
 */
export function parseWorkspaceRow({
  entry,
  windowId,
}: {
  entry: unknown;
  windowId: string;
}): CmuxWorkspaceSummary | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const workspaceId = nonEmptyString({ field: "id", value: entry });
  const workspaceRef = nonEmptyString({ field: "ref", value: entry });
  const currentDirectory = nonEmptyString({ field: "current_directory", value: entry });
  if (workspaceId === undefined || workspaceRef === undefined || currentDirectory === undefined) {
    return undefined;
  }
  return {
    currentDirectory,
    description: nonEmptyString({ field: "description", value: entry }),
    latestConversationMessage: nonEmptyString({ field: "latest_conversation_message", value: entry }),
    latestSubmittedAtIso: nonEmptyString({ field: "latest_submitted_at", value: entry }),
    latestSubmittedMessage: nonEmptyString({ field: "latest_submitted_message", value: entry }),
    pinned: entry["pinned"] === true,
    selected: entry["selected"] === true,
    title: nonEmptyString({ field: "title", value: entry }),
    windowId,
    workspaceId,
    workspaceRef,
  };
}
