/**
 * The row-level fields `./read.ts`'s `readBoardRow` reads off one published board row: its lists, its
 * pull-request links and the `context=` its tag registry refused.
 */
import { type Bag, isBag, strings } from "../../lib/bag";
import { repositoryOf } from "../../lib/workspacePlacementAddress";

/**
 * A list a row publishes — its `blockedBy:` slugs, its card's scenes — or none when absent or not all strings.
 *
 * @returns the entries, in published order
 */
export function listOf({ row, key }: { row: Bag; key: "blockedBy" | "examples" }): readonly string[] {
  const raw = strings({ bag: row, key });
  if (raw === undefined) {
    return [];
  }
  return raw;
}

/**
 * The pull-request links one row publishes.
 *
 * An absent field is no links, written as an `if` that RETURNS rather than a `??` — `no-silent-fallback`
 * refuses the operator, and here the substitution is worth saying out loud anyway: a board
 * cut before this field existed carries none, which is not the same as a row that has no PR.
 *
 * @param row the row's raw bag
 * @returns the links, empty when the field is absent or is not a list of strings
 */
export function prUrlsOf({ row }: { row: Bag }): readonly string[] {
  const raw = strings({ bag: row, key: "prUrls" });
  if (raw === undefined) {
    return [];
  }
  return raw;
}

/** A pull-request link as `handover list --json` publishes one: the verb's own match, to the number and no further. */
const PUBLISHED_PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[0-9]+$/;

/**
 * Whether a row's published `prUrls` did not read whole: not a list of strings, or holding a member that is not a
 * pull-request link as the verb publishes one — either way an address may be hidden, so the row is a finding.
 *
 * @returns true when the field is present and any of it would not read
 */
export function prUrlsUnread({ row }: { row: Bag }): boolean {
  if (row["prUrls"] === undefined) {
    return false;
  }
  const raw = strings({ bag: row, key: "prUrls" });
  if (raw === undefined) {
    return true;
  }
  // Held to the placement reader too: a link this shape admits that names no repository (`slopweaver.git/pull/<number>`)
  // would otherwise be skipped as evidence while the list read whole.
  return raw.some((url) => !PUBLISHED_PR_URL.test(url) || repositoryOf({ value: url }) === undefined);
}

/**
 * The `context=` a row's tag registry refused, as `handover list --json` publishes it under `unrecognisedTags`
 * (`src/cli/commands/handover/listJson.ts`), or what would not read there when the list or a member of it is not
 * the `{ key, value }` shape, since a member that will not read may be a `context=`.
 *
 * @param row the published board row
 * @returns the refused value, what would not read, or `undefined` when the row carries no refused `context=`
 */
export function contextUnreadOf({ row }: { row: Bag }): string | undefined {
  const raw: unknown = row["unrecognisedTags"];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  for (const entry of raw as readonly unknown[]) {
    if (!isBag(entry) || typeof entry["key"] !== "string" || typeof entry["value"] !== "string") {
      return JSON.stringify(entry);
    }
    if (entry["key"] === "context") {
      return entry["value"];
    }
  }
  return undefined;
}
