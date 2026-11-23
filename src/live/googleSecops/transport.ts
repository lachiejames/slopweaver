/**
 * The Google SecOps door's one way to the network: a GET, to the configured instance's own regional host,
 * on a path under that instance. Nothing else is expressible here.
 *
 * SecOps is approved as a read-only data source: nothing ever writes onto SecOps, neither via API nor the
 * browser. The scope cannot carry that alone — `chronicle.readonly`
 * gates several POST methods Chronicle itself classes as reads, and a later `cloud-platform` would gate
 * every write — so the method is a TYPE with one member, and the URL is refused before any call when it
 * would leave the instance. `readOnlyRail.test.ts` fails the tree if a second method or host ever appears.
 */
import type { OAuth2Client } from "googleapis-common";

import { unsetFieldAsNull } from "#lib/absent.js";

import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GoogleSecopsReadError, GoogleSecopsReadErrors } from "./errors.js";
import type { SecopsInstance } from "./instance.js";

/** The only HTTP method this door sends. A second member here is the read-only ruling broken. */
export type SecopsHttpMethod = "GET";

/** The Chronicle API versions this door reads. v1 is the pinned inventory; v1alpha is not fetched yet. */
const ALLOWED_VERSIONS: ReadonlySet<string> = new Set(["v1"]);

/** A resource path under the instance: slash-separated id segments, optionally one `:customRead` suffix. */
const RELATIVE_PATH = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?::[A-Za-z]+)?$/;

/**
 * A custom method on the instance itself, `:listAllFindingsRefinementDeployments` — the binding is
 * `/v1/{instance=...}:verb`, so there is no collection segment between the instance and the colon.
 */
const INSTANCE_METHOD = /^:[A-Za-z]+$/;

/** The only query parameters a read sends: paging. A filter or a view would be a read this door never chose. */
const QUERY_KEYS: ReadonlySet<string> = new Set(["pageSize", "pageToken"]);

/**
 * Build the URL for one read under the instance, refusing anything that would leave it.
 *
 * The relative path is held to a strict grammar first, and the built URL is then checked again AFTER the
 * URL parser has normalised it, so neither a dot segment nor a percent-encoded one can walk out.
 *
 * @param instance the configured instance, which fixes the origin and the path prefix
 * @param apiVersion the Chronicle API version segment
 * @param relativePath the path under the instance, e.g. `rules` or `dataTables/abc/dataTableRows`, or a
 * custom method on the instance itself, e.g. `:listAllFindingsRefinementDeployments`
 * @param query paging parameters to set — `pageSize` and `pageToken`, and no other key
 * @returns the URL, or `PATH_REFUSED`/`HOST_REFUSED`
 */
export function buildSecopsUrl({
  instance,
  apiVersion,
  relativePath,
  query,
}: {
  instance: SecopsInstance;
  apiVersion: string;
  relativePath: string;
  query: Readonly<Record<string, string>>;
}): Result<URL, GoogleSecopsReadError> {
  if (!ALLOWED_VERSIONS.has(apiVersion)) {
    return err(
      GoogleSecopsReadErrors.pathRefused({ path: relativePath, why: `API version ${apiVersion} is not read` }),
    );
  }
  const instanceMethod = INSTANCE_METHOD.test(relativePath);
  if (!instanceMethod && !RELATIVE_PATH.test(relativePath)) {
    return err(
      GoogleSecopsReadErrors.pathRefused({ path: relativePath, why: "not a resource path under the instance" }),
    );
  }
  const unknownKey = Object.keys(query).find((name) => !QUERY_KEYS.has(name));
  if (unknownKey !== undefined) {
    return err(
      GoogleSecopsReadErrors.pathRefused({
        path: relativePath,
        why: `query parameter ${unknownKey} is not one this door sends — paging only`,
      }),
    );
  }
  const base = `/${apiVersion}/${instance.name}`;
  const expected = instanceMethod ? `${base}${relativePath}` : `${base}/${relativePath}`;
  const url = new URL(expected, instance.origin);
  if (url.origin !== instance.origin) {
    return err(GoogleSecopsReadErrors.hostRefused({ expected: instance.origin, origin: url.origin }));
  }
  const inside = instanceMethod ? url.pathname === expected : url.pathname.startsWith(`${base}/`);
  if (!inside) {
    return err(GoogleSecopsReadErrors.pathRefused({ path: url.pathname, why: "the path leaves the instance" }));
  }
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return ok(url);
}

/**
 * Send ONE GET through the paced provider door.
 *
 * @param client the OAuth client from a resolved SecOps grant
 * @param url a URL {@link buildSecopsUrl} built — the only way this module makes one
 * @param scopeId the shared rate scope, already hashed from the bound credential
 * @returns the response body, untyped until a per-endpoint boundary reads it, or `TRANSPORT_FAILED`
 */
export async function secopsGet({
  client,
  url,
  scopeId,
}: {
  client: OAuth2Client;
  url: URL;
  scopeId: string;
}): Promise<Result<unknown, GoogleSecopsReadError>> {
  const method: SecopsHttpMethod = "GET";
  const answered = await safeProviderCall({
    execute: () => client.request<unknown>({ method, url: url.toString() }),
    operation: "google-secops.api.read",
    provider: "google-secops",
    retryMode: "transient",
    scopeId,
  });
  if (answered.isErr()) {
    return err(
      GoogleSecopsReadErrors.transportFailed({
        message: answered.error.message,
        status: unsetFieldAsNull({ key: "status", record: answered.error }),
      }),
    );
  }
  return ok(answered.value.data);
}
