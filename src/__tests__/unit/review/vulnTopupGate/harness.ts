/**
 * Shared fixtures for the merge-release gate's unit tests, one file per `describe` beside this one: the generation
 * prefix, a batch line exactly as `topupAsk` writes it, and a backfill brief.
 */
import { backfillSentence } from "../../../../review/vulnTopupBatchRead.js";

export const PREFIX = "vulnfix-topup-owner-name";

/**
 * A batch line exactly as `topupAsk` writes it.
 *
 * @returns the indented dash line naming the package and citing its alert URL in owner/name
 */
export function line({ name, number }: { name: string; number: number }): string {
  return (
    `  - ${name} (npm, yarn.lock) — high CVSS 8.8, GHSA-x, ` +
    `alert https://github.com/owner/name/security/dependabot/${String(number)}, first patched 1.0.0`
  );
}

/**
 * A batch as `topupAsk` now writes it: happy-dom and the MCP SDK, with shell-quote and find-my-way
 * to backfill a skipped member, under a backfill sentence stating `backfill`.
 *
 * @returns the whole brief, its lines joined by newlines
 */
export function backfillAsk({ backfill }: { backfill: number }): string {
  return [
    "Raise 2 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
    "",
    "The batch, worst CVSS first:",
    line({ name: "happy-dom", number: 1141 }),
    line({ name: "@modelcontextprotocol/sdk", number: 1108 }),
    "",
    backfillSentence({ count: backfill }),
    line({ name: "shell-quote", number: 1084 }),
    line({ name: "find-my-way", number: 842 }),
    "",
    "Left out as already ruled not a bump (live/vuln/not-a-bump.json): @fastify/reply-from, fastify.",
  ].join("\n");
}
