/**
 * The workspaces earlier creates under one fingerprint already made, so a later create's lost reply never adopts one.
 *
 * `./workspaceCreateRecovery.ts` serialises creates under a fingerprint's lock, but a lock released on a create that
 * ANSWERED leaves its workspace to a snapshot the next create takes. That snapshot can miss it: the strict inventory
 * reads window by window, so a workspace moved between windows mid-read is in neither, and one not yet visible across
 * connections is not there at all. The next create then losing its reply saw it as the one new matching row and typed
 * a boot line into a live caller's tab. Each create that made or adopted a workspace records its
 * id here before the lock is released, and a reconciliation never adopts a recorded id.
 *
 * Kept per fingerprint key under the state home, beside the operation locks, newest last, the last
 * {@link MAX_WORKSPACE_CREATE_CLAIMS} only: a claim matters only while its workspace could still be read as new.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * How many claims one fingerprint keeps — far more creates than one supervisor runs in a tab's lifetime. RESIDUE,
 * stated: a 33rd still-live tab under the SAME directory and description evicts the oldest claim, and a
 * later lost create whose snapshot also misses that tab could adopt it. One doc slug is seated in one tab at a time.
 */
export const MAX_WORKSPACE_CREATE_CLAIMS = 32;

/** The claims file is there and would not read. */
export interface ClaimsUnreadableError {
  readonly code: "CLAIMS_UNREADABLE";
  readonly message: string;
  readonly path: string;
}
/** The claims file read, and is not a claims file. */
export interface ClaimsMalformedError {
  readonly code: "CLAIMS_MALFORMED";
  readonly message: string;
  readonly path: string;
}
/** The claims file could not be written. */
export interface ClaimsUnwritableError {
  readonly code: "CLAIMS_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}
/** Why one fingerprint's claims could not be read or kept. */
export type WorkspaceCreateClaimsError = ClaimsUnreadableError | ClaimsMalformedError | ClaimsUnwritableError;

/** The {@link WorkspaceCreateClaimsError} factory. */
export const WorkspaceCreateClaimsErrors = {
  malformed: ({ path, why }: { path: string; why: string }): ClaimsMalformedError => ({
    code: "CLAIMS_MALFORMED",
    message: `${path} is not a create-claims file: ${why}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): ClaimsUnreadableError => ({
    code: "CLAIMS_UNREADABLE",
    message: `${path} would not read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): ClaimsUnwritableError => ({
    code: "CLAIMS_UNWRITABLE",
    message: `${path} could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/**
 * The file one fingerprint's claims live in, named by a hash of its lock key so any directory and description fit.
 *
 * @param home the state home the create lock is taken under
 * @param key the fingerprint's create-lock key
 * @returns the claims file's path
 */
export function workspaceCreateClaimsPath({ home, key }: { home: string; key: string }): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(stateHomePaths({ home }).ledgers, "cmux-create-claims", `${digest}.json`);
}

/**
 * Parse a claims file's text: an object whose `workspaceIds` is a list of strings.
 *
 * @param text the file's contents
 * @param path where it was read, named in the refusal
 * @returns the claimed ids, oldest first, or why the file is not a claims file
 */
export function parseWorkspaceCreateClaims({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<string[], WorkspaceCreateClaimsError> {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: path, text });
  } catch (cause) {
    const why = `not JSON (${cause instanceof Error ? cause.message : String(cause)})`;
    return err(WorkspaceCreateClaimsErrors.malformed({ path, why }));
  }
  if (!isRecord(parsed)) {
    return err(WorkspaceCreateClaimsErrors.malformed({ path, why: "not an object" }));
  }
  const ids = parsed["workspaceIds"];
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === "string")) {
    return err(WorkspaceCreateClaimsErrors.malformed({ path, why: "its workspaceIds is not a list of workspace ids" }));
  }
  return ok(ids);
}

/**
 * Read one fingerprint's claims. A file that does not exist is no claims, by design: no create under it has answered
 * yet. One that will not read or parse is a refusal, never an empty list — an empty list is what lets a lost reply
 * adopt a live caller's tab.
 *
 * @param home the state home the create lock is taken under
 * @param key the fingerprint's create-lock key
 * @returns the claimed ids, oldest first, or why they could not be read
 */
export function readWorkspaceCreateClaims({
  home,
  key,
}: {
  home: string;
  key: string;
}): Result<string[], WorkspaceCreateClaimsError> {
  const path = workspaceCreateClaimsPath({ home, key });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok([]);
    }
    return err(WorkspaceCreateClaimsErrors.unreadable({ cause, path }));
  }
  return parseWorkspaceCreateClaims({ path, text });
}

/**
 * The claims list after one more create made `workspaceId`: appended once, the oldest dropped past the bound.
 *
 * @param claims the ids already claimed, oldest first
 * @param workspaceId the workspace this create made or adopted
 * @returns the new list, oldest first
 */
export function withWorkspaceCreateClaim({
  claims,
  workspaceId,
}: {
  claims: readonly string[];
  workspaceId: string;
}): string[] {
  return [...claims.filter((id) => id !== workspaceId), workspaceId].slice(-MAX_WORKSPACE_CREATE_CLAIMS);
}

/**
 * Record that a create under `key` made or adopted `workspaceId`, written atomically while the caller holds the lock.
 *
 * @param home the state home the create lock is taken under
 * @param key the fingerprint's create-lock key
 * @param claims the ids read when the lock was taken
 * @param workspaceId the workspace this create made or adopted
 * @returns nothing on success, or why the claim could not be written
 */
export function recordWorkspaceCreateClaim({
  home,
  key,
  claims,
  workspaceId,
}: {
  home: string;
  key: string;
  claims: readonly string[];
  workspaceId: string;
}): Result<void, WorkspaceCreateClaimsError> {
  const path = workspaceCreateClaimsPath({ home, key });
  try {
    writeFileAtomic({
      contents: `${JSON.stringify({ workspaceIds: withWorkspaceCreateClaim({ claims, workspaceId }) })}\n`,
      path,
    });
  } catch (cause) {
    return err(WorkspaceCreateClaimsErrors.unwritable({ cause, path }));
  }
  return ok(undefined);
}
