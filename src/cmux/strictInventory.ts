/**
 * The workspace inventory, read so that NOTHING is dropped — what a timed-out create is reconciled against, both
 * the snapshot before it and every read after it (`./workspaceCreateRecovery.ts`).
 *
 * `./client.ts`'s `listWorkspaces` is deliberately lossy: a row missing its ref or directory is dropped, and so is
 * a whole window's reply that does not echo its window id, because one bad row must not blind a collision check
 * to every other workspace. For reconciliation that is the wrong failure direction, in both places. A row dropped
 * from the snapshot reads as NEW once a later read decodes it; a second matching row dropped from a later read
 * makes the one that survived look like the only candidate. Either way the result is a boot line typed into a
 * workspace that was not proven to be this create's. So this read refuses the reply instead of dropping from it.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxClient, CmuxWorkspaceSummary } from "./client.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import type { CmuxCall } from "./workspaceAddresses.js";
import { nonEmptyString, parseWorkspaceRow } from "./workspaceRow.js";

/** A reply's list field, or the typed failure when it is not an array. */
function listField({
  value,
  field,
  method,
}: {
  value: unknown;
  field: string;
  method: string;
}): Result<readonly unknown[], CmuxError> {
  const entries = isRecord(value) ? value[field] : undefined;
  return Array.isArray(entries)
    ? ok(entries)
    : err(CmuxErrors.malformedReply({ detail: `no array field "${field}"`, method }));
}

/**
 * Decode a `window.list` reply into every window id, refusing a window with none.
 *
 * @param value the decoded reply
 * @returns every window id, or the typed failure naming the window that carried none
 */
export function parseWindowIdsStrict({ value }: { value: unknown }): Result<readonly string[], CmuxError> {
  const method = "window.list";
  return listField({ field: "windows", method, value }).andThen((entries) => {
    const ids: string[] = [];
    for (const [index, entry] of entries.entries()) {
      const id = nonEmptyString({ field: "id", value: entry });
      if (id === undefined) {
        return err(CmuxErrors.malformedReply({ detail: `windows[${String(index)}] carries no id`, method }));
      }
      ids.push(id);
    }
    return ok(ids);
  });
}

/**
 * Decode a `workspace.list` reply into every row, refusing the reply when one row could not be decoded.
 *
 * @param value the decoded reply
 * @returns every row, or the typed failure naming the row that was missing an id, a ref or a directory
 */
export function parseWorkspaceListStrict({ value }: { value: unknown }): Result<CmuxWorkspaceSummary[], CmuxError> {
  const method = "workspace.list";
  const windowId = nonEmptyString({ field: "window_id", value });
  if (windowId === undefined) {
    return err(CmuxErrors.malformedReply({ detail: 'no string field "window_id"', method }));
  }
  return listField({ field: "workspaces", method, value }).andThen((entries) => {
    const rows: CmuxWorkspaceSummary[] = [];
    for (const [index, entry] of entries.entries()) {
      const row = parseWorkspaceRow({ entry, windowId });
      if (row === undefined) {
        const detail = `workspaces[${String(index)}] is missing an id, a ref or a directory`;
        return err(CmuxErrors.malformedReply({ detail, method }));
      }
      // The description is half the fingerprint a timed-out create is matched on, so a value that is neither a
      // string nor unset must not decode to "no description" and match a create that was sent without one.
      const described: unknown = isRecord(entry) ? entry["description"] : undefined;
      if (described != null && typeof described !== "string") {
        const detail = `workspaces[${String(index)}] carries a description that is not a string`;
        return err(CmuxErrors.malformedReply({ detail, method }));
      }
      rows.push(row);
    }
    return ok(rows);
  });
}

/**
 * `window.list`, then `workspace.list` per window — the fan-out `listWorkspaces` makes, failing where it drops.
 *
 * @param call the socket call to issue it through
 * @returns the client's `listWorkspacesStrict`
 */
export function listWorkspacesStrictOver({ call }: { call: CmuxCall }): CmuxClient["listWorkspacesStrict"] {
  return async () => {
    const windows = (await call({ method: "window.list", params: {} })).andThen((value) =>
      parseWindowIdsStrict({ value }),
    );
    if (windows.isErr()) {
      return err(windows.error);
    }
    const rows: CmuxWorkspaceSummary[] = [];
    for (const windowId of windows.value) {
      const listed = (await call({ method: "workspace.list", params: { window_id: windowId } })).andThen((value) =>
        parseWorkspaceListStrict({ value }),
      );
      if (listed.isErr()) {
        return err(listed.error);
      }
      rows.push(...listed.value);
    }
    return ok(rows);
  };
}
