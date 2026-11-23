/**
 * The GCP door's reads that stand on their own — `run describe`, `secret describe`, `secret access` — and the
 * paged version list both they and a write's plan read. A 404 here stays `NOT_FOUND`; the write-planning reads in
 * `./operations.ts` are the ones that answer it as "does not exist yet".
 */
import { err, ok, type Result } from "#lib/result.js";

import type { GcpDoorError } from "./errors.js";
import { cutMessage, literalEnvValues } from "./redact.js";
import type { RunServiceRef, SecretRef } from "./request.js";
import { type DecodedSecretPayload, decodeSecretPayload } from "./secretPayload.js";
import { callGcp, type GcpDoorSend } from "./transport.js";
import {
  IAM_POLICY,
  type IamPolicy,
  RUN_SERVICE,
  type RunService,
  SECRET,
  SECRET_ACCESS,
  SECRET_VERSIONS,
  type SecretVersion,
} from "./wire.js";

/**
 * Every version of a secret, every page.
 *
 * @param send the sender
 * @param ref the secret
 * @returns the versions, newest first as Google lists them, or the failure
 */
export async function listSecretVersions({
  send,
  ref,
}: {
  send: GcpDoorSend;
  ref: SecretRef;
}): Promise<Result<readonly SecretVersion[], GcpDoorError>> {
  const versions: SecretVersion[] = [];
  let pageToken: string | undefined;
  do {
    const page = await callGcp({
      boundary: SECRET_VERSIONS,
      request: { kind: "secret-version-list", ...ref, ...(pageToken === undefined ? {} : { pageToken }) },
      send,
    });
    if (page.isErr()) {
      return err(page.error);
    }
    // A page of none omits `versions`, the way proto3 JSON drops every empty list.
    if (page.value.versions !== undefined) {
      versions.push(...page.value.versions);
    }
    pageToken = page.value.nextPageToken === "" ? undefined : page.value.nextPageToken;
  } while (pageToken !== undefined);
  return ok(versions);
}

/** What `run describe` reads. */
export interface RunDescription {
  readonly service: RunService;
  readonly policy: IamPolicy;
}

/**
 * Read a Cloud Run service and its IAM policy.
 *
 * @param send the sender
 * @param ref the service
 * @returns both, or the failure
 */
export async function describeRunService({
  send,
  ref,
}: {
  send: GcpDoorSend;
  ref: RunServiceRef;
}): Promise<Result<RunDescription, GcpDoorError>> {
  const service = await callGcp({ boundary: RUN_SERVICE, request: { kind: "run-service-get", ...ref }, send });
  if (service.isErr()) {
    return err(service.error);
  }
  const policy = await callGcp({ boundary: IAM_POLICY, request: { kind: "run-iam-get", ...ref }, send });
  // The service, env values and all, was read first, so a policy failure is cut against them before it can print.
  return policy
    .map((value) => ({ policy: value, service: service.value }))
    .mapErr((error) => cutMessage({ error, values: literalEnvValues({ template: service.value.template }) }));
}

/** What `secret describe` reads. Never a payload. */
export interface SecretDescription {
  readonly name: string;
  readonly createTime: string | undefined;
  readonly versions: readonly SecretVersion[];
  readonly policy: IamPolicy;
}

/**
 * Read a secret's metadata, every version's state and its IAM policy.
 *
 * @param send the sender
 * @param ref the secret
 * @returns the description, or the failure
 */
export async function describeSecret({
  send,
  ref,
}: {
  send: GcpDoorSend;
  ref: SecretRef;
}): Promise<Result<SecretDescription, GcpDoorError>> {
  const secret = await callGcp({ boundary: SECRET, request: { kind: "secret-get", ...ref }, send });
  if (secret.isErr()) {
    return err(secret.error);
  }
  const versions = await listSecretVersions({ ref, send });
  if (versions.isErr()) {
    return err(versions.error);
  }
  const policy = await callGcp({ boundary: IAM_POLICY, request: { kind: "secret-iam-get", ...ref }, send });
  return policy.map((value) => ({
    createTime: secret.value.createTime,
    name: secret.value.name,
    policy: value,
    versions: versions.value,
  }));
}

/** One accessed version: its resolved name and its decoded, checked payload. */
export interface AccessedSecret {
  readonly name: string;
  readonly payload: DecodedSecretPayload;
}

/**
 * Access one version's payload and check it against its CRC32C.
 *
 * @param send the sender
 * @param ref the secret
 * @param version a number or `latest`
 * @returns the resolved version name and payload, or the failure
 */
export async function accessSecret({
  send,
  ref,
  version,
}: {
  send: GcpDoorSend;
  ref: SecretRef;
  version: string;
}): Promise<Result<AccessedSecret, GcpDoorError>> {
  const accessed = await callGcp({
    boundary: SECRET_ACCESS,
    request: { kind: "secret-version-access", ...ref, version },
    send,
  });
  if (accessed.isErr()) {
    return err(accessed.error);
  }
  return decodeSecretPayload({ data: accessed.value.payload.data, dataCrc32c: accessed.value.payload.dataCrc32c }).map(
    (payload) => ({ name: accessed.value.name, payload }),
  );
}
