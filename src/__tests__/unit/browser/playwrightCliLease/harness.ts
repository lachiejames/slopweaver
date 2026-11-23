/*
 * What the Playwright CLI lease test files share: a Notion relay lease, and the terminal client's stdout for one
 * visit. It moved here when `playwrightCliLease.test.ts` was split by behaviour.
 */
import type { RelayLease } from "../../../../browser/relayLease.js";

/** A relay lease bound to Notion's own origin, whose release does nothing. */
export const NOTION_LEASE: RelayLease = {
  origins: ["https://app.notion.com"],
  platform: "notion",
  release: () => {},
};

/**
 * What the terminal client prints for one visit: an envelope whose `result` is the snippet's own JSON.
 *
 * @returns the client's stdout, the snippet double-encoded inside a `result` envelope
 */
export function clientStdout(snippet: Record<string, unknown>): string {
  return JSON.stringify({ result: JSON.stringify(snippet) });
}
