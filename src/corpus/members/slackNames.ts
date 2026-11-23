/**
 * Slack user id → display name, off the member rows `refresh members`/`derive` stored. Read-only and never
 * refreshed here: the console voice's live Slack reads and `responders list` name people from it.
 */
import { readMemberRows } from "./store.js";

/**
 * Name each Slack member the stored rows know. A row with no name gives its handle; one with neither is left
 * out, so a caller reads the id as unnamed rather than as a blank.
 *
 * @param home the state home the member rows are read from; absent, the installed one
 * @returns the id → name map, and each warning the member-row read raised (an unreadable file, a bad line)
 */
export function slackMemberNames({ home }: { home: string | undefined }): {
  names: Record<string, string>;
  warnings: readonly string[];
} {
  const { rows, warnings } = readMemberRows({ source: "slack", ...(home !== undefined ? { home } : {}) });
  const entries: [string, string][] = [];
  for (const row of rows) {
    const { name, handle, nativeId } = row.identity;
    if (name !== undefined && name.length > 0) {
      entries.push([nativeId, name]);
    } else if (handle !== undefined && handle.length > 0) {
      entries.push([nativeId, handle]);
    }
  }
  // `fromEntries` defines each key as an own property, so an id spelled `__proto__` is a key, never the prototype.
  return { names: Object.fromEntries(entries), warnings };
}
