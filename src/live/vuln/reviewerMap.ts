/**
 * WHO the dependency-bump posts ask, as one installation's roster — and which person a GitHub login means.
 *
 * ## Why this is a file and not a derivation
 *
 * The identity map links a person across Slack, Linear and Notion by their trusted email, and GitHub
 * accounts in this organisation carry none — so a GitHub login does not resolve. MEASURED, and reproducible
 * in one command each: `slopweaver identity resolve quinn-acme` refuses ("the only match carries no
 * trusted email"), while `slopweaver identity resolve quinn` resolves. Mangling one into the other is
 * guessing, and it fails on the very next login — `jaspernolan-acme` needs a full name with a space in
 * it that no suffix rule produces. So the association is written down, as `logins`.
 *
 * The roster is written down beside it for a different reason: who reviews these posts by default is the
 * channel's own convention about people, not a fact about the repository. The RULE that reads it lives in
 * code (`../../review/vulnReviewerChoice.ts`); the people it names live here.
 *
 * ## Why it lives outside the repository
 *
 * It is per-install state naming real people, so it resolves at runtime from `$SLOPWEAVER_HOME` rather than
 * from a constant — `AGENTS.md` § "Porting from private sources", "tools in the codebase, state outside it".
 *
 * ## There is no team table
 *
 * A GitHub TEAM never decides who a line asks. MEASURED: collapsing `@acme/acme-eng`
 * onto one member put the same person on 19 of 20 lines across both posts, when the channel's convention
 * names two default reviewers who are both on that team. A team is answered by its MEMBERSHIP, read live,
 * and the rule picks the roster person who is in it. A `teams` key in the file is ignored.
 */
import { readFileSync } from "node:fs";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";

/** One installation's reviewer roster, and the person each roster login means. */
export interface VulnReviewerMap {
  /**
   * A GitHub LOGIN (`quinn-acme`), lower-cased, to the identity-map key a `mention` run takes.
   *
   * Keyed without the `@` CODEOWNERS spells, because the `@` is the notation, not the name.
   */
  readonly logins: Readonly<Record<string, string>>;
  /**
   * The logins every line asks by default, in the order a tie between them is broken. Never empty, and
   * every one is a key of {@link logins}.
   */
  readonly defaults: readonly string[];
  /**
   * The logins a line may ask instead, in preference order, when no default can satisfy the code-owner rules
   * GitHub still holds on it. May be empty; every one is a key of {@link logins}.
   */
  readonly fallbacks: readonly string[];
}

/**
 * The map file is absent, unreadable, or not a reviewer map.
 *
 * @internal
 */
export interface ReviewerMapUnreadableError {
  readonly code: "REVIEWER_MAP_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way the reviewer map read can fail. */
export type VulnReviewerError = ReviewerMapUnreadableError;

/**
 * Build one {@link VulnReviewerError}. Tests construct fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const VulnReviewerErrors = {
  unreadable: ({ path, why }: { path: string; why: string }): ReviewerMapUnreadableError => ({
    code: "REVIEWER_MAP_UNREADABLE",
    message: `cannot read the reviewer map at ${path}: ${why}`,
    path,
  }),
} as const;

/** What a well-formed file holds, said once so every refusal names the same shape. */
const EXPECTED_SHAPE =
  "expected `logins` (GitHub login → identity-map key), `defaults` (a non-empty list of logins) and " +
  "`fallbacks` (a list of logins), every listed login a key of `logins`";

/**
 * Read one installation's reviewer map.
 *
 * @param home the state home to resolve it under
 * @param readFile the file read, injectable so a unit test needs no filesystem
 * @returns the map, or why it could not be read
 */
export function readVulnReviewerMap({
  home,
  readFile = (path) => readFileSync(path, "utf8"),
}: {
  home: string;
  readFile?: (path: string) => string;
}): Result<VulnReviewerMap, VulnReviewerError> {
  const path = stateHomePaths({ home }).live.vuln.reviewersJson;
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    return err(VulnReviewerErrors.unreadable({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "reviewer map", text });
  } catch (error) {
    return err(VulnReviewerErrors.unreadable({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  const shaped = reviewerMapShape({ value: decoded });
  if (typeof shaped === "string") {
    return err(VulnReviewerErrors.unreadable({ path, why: shaped }));
  }
  return ok(shaped);
}

/** Narrow decoded JSON to the map's shape, or say what is wrong with it. */
function reviewerMapShape({ value }: { value: unknown }): VulnReviewerMap | string {
  if (!isRecord(value)) {
    return EXPECTED_SHAPE;
  }
  const logins = stringTable({ value: value["logins"] });
  const defaults = loginList({ value: value["defaults"] });
  const fallbacks = loginList({ value: value["fallbacks"] });
  if (logins === undefined || defaults === undefined || fallbacks === undefined || defaults.length === 0) {
    return EXPECTED_SHAPE;
  }
  // An own key, never `logins[login]`: `constructor` would read as mapped off the object's prototype.
  const unmapped = [...defaults, ...fallbacks].filter((login) => !Object.hasOwn(logins, login));
  if (unmapped.length > 0) {
    return `${unmapped.join(", ")} ${unmapped.length === 1 ? "is" : "are"} on the roster but not under \`logins\` — ${EXPECTED_SHAPE}`;
  }
  return { defaults, fallbacks, logins };
}

/** Narrow one field to a flat login-to-person table, logins lower-cased, or `undefined` when a value is not a non-empty string. */
function stringTable({ value }: { value: unknown }): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const table: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.length === 0) {
      return undefined;
    }
    table[key.replace(/^@/, "").toLowerCase()] = item;
  }
  return table;
}

/** Narrow one field to a list of logins, lower-cased, or `undefined` when it is not a list of strings. */
function loginList({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const logins: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      return undefined;
    }
    logins.push(item.replace(/^@/, "").toLowerCase());
  }
  return logins;
}
