/**
 * The pieces every request builder in `./request.ts` and `./requestRunSecret.ts` shares: the fixed hosts, the
 * name check, and the one function that turns a base and a checked path into a URL — refusing it when URL
 * normalisation would move the path. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { checkName, type GcpNameKind } from "./names.js";
import type { BuiltGcpDoorRequest } from "./request.js";

/** Cloud Run Admin API v2. */
export const RUN = "https://run.googleapis.com/v2";
/** Secret Manager v1. */
export const SECRET_MANAGER = "https://secretmanager.googleapis.com/v1";
/** IAM v1, for service accounts. */
export const IAM = "https://iam.googleapis.com/v1";
/** Service Usage v1. */
export const SERVICE_USAGE = "https://serviceusage.googleapis.com/v1";
/** Artifact Registry v1. */
export const ARTIFACT_REGISTRY = "https://artifactregistry.googleapis.com/v1";

/**
 * Check every name a request carries, in order, stopping at the first that fails.
 *
 * @param names each name with its kind; an undefined value is skipped
 * @returns nothing, or `INPUT_INVALID` naming the first bad name
 */
export function checkAll({
  names,
}: {
  names: readonly (readonly [GcpNameKind, string | undefined])[];
}): Result<void, GcpDoorError> {
  for (const [kind, value] of names) {
    if (value === undefined) {
      continue;
    }
    const checked = checkName({ kind, value });
    if (checked.isErr()) {
      return err(checked.error);
    }
  }
  return ok(undefined);
}

/**
 * A URL from a fixed base and a path made of checked names, refused when normalisation would move the path.
 *
 * @param base the host and version, with no trailing slash
 * @param path the path below it, opening on `/`
 * @param query the query parameters; an undefined value is left off
 * @returns the URL text, or `REQUEST_REFUSED`
 */
export function fixedUrl({
  base,
  path,
  query,
}: {
  base: string;
  path: string;
  query: Readonly<Record<string, string | undefined>>;
}): Result<string, GcpDoorError> {
  const url = new URL(`${base}${path}`);
  if (url.pathname !== `${new URL(base).pathname}${path}`) {
    return err(GcpDoorErrors.requestRefused({ what: path, why: "a name in it changes the URL path" }));
  }
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return ok(url.toString());
}

/**
 * Assemble one built request once its URL is fixed.
 *
 * @param url the fixed URL, or its refusal
 * @param shape everything but the URL
 * @returns the request, or the URL's refusal
 */
export function built({
  url,
  shape,
}: {
  url: Result<string, GcpDoorError>;
  shape: Omit<BuiltGcpDoorRequest, "url">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  return url.map((text) => ({ ...shape, url: text }));
}
