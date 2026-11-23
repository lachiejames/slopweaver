/**
 * The Cloud Run and Secret Manager halves of `./request.ts`'s one way to the network: each call mapped to exactly
 * one method, host and path. Pure, and reached only through `buildGcpDoorRequest`.
 */
import { err, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import type { BuiltGcpDoorRequest, RequestOf, RunServiceRef } from "./request.js";
import { built, checkAll, fixedUrl, RUN, SECRET_MANAGER } from "./requestUrl.js";

/** A page token is opaque, but never a place to smuggle a path or a second parameter. */
const PAGE_TOKEN = /^[A-Za-z0-9_\-=.+/]{1,4096}$/;

/** A CRC32C as Secret Manager's JSON carries it: an int64 as decimal text. */
const CRC32C = /^\d{1,10}$/;

/** A payload as base64 text, at most 64 KiB once decoded. */
const BASE64 = /^[A-Za-z0-9+/]{0,87384}={0,2}$/;

/** A Cloud Run service's path below the API root. */
function runServicePath({ ref }: { ref: RunServiceRef }): string {
  return `/projects/${ref.project}/locations/${ref.region}/services/${ref.service}`;
}

/** A Cloud Run service's names, checked. */
function checkRun({ ref }: { ref: RunServiceRef }): Result<void, GcpDoorError> {
  return checkAll({
    names: [
      ["project", ref.project],
      ["region", ref.region],
      ["run-service", ref.service],
    ],
  });
}

/**
 * A Cloud Run service read, create, patch or IAM call.
 *
 * Create is `POST …/services?serviceId=`, which Google refuses when the service exists; patch is `PATCH` on the
 * service with `updateMask=template` and the read `etag` in the body, which Google refuses when the service
 * changed since the read. Neither sets `allowMissing`, so neither can do the other's job.
 *
 * @param request the Cloud Run call
 * @returns the request, or the refusal
 */
// max-lines-exempt: a per-kind dispatch whose whole body is one closed request per Cloud Run kind; a split would put a kind's URL and method away from its case
export function buildRun({
  request,
}: {
  request: RequestOf<"run-service-get" | "run-service-create" | "run-service-patch" | "run-iam-get" | "run-iam-set">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  const checked = checkRun({ ref: request });
  if (checked.isErr()) {
    return err(checked.error);
  }
  const path = runServicePath({ ref: request });
  switch (request.kind) {
    case "run-service-get":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.run.services.get" },
        url: fixedUrl({ base: RUN, path, query: {} }),
      });
    case "run-service-create":
      return built({
        shape: {
          body: { template: request.template },
          effect: "write",
          method: "POST",
          operation: "gcp.run.services.create",
        },
        url: fixedUrl({
          base: RUN,
          path: `/projects/${request.project}/locations/${request.region}/services`,
          query: { serviceId: request.service },
        }),
      });
    case "run-service-patch":
      return built({
        shape: {
          body: { etag: request.etag, template: request.template },
          effect: "write",
          method: "PATCH",
          operation: "gcp.run.services.patch",
        },
        url: fixedUrl({ base: RUN, path, query: { updateMask: "template" } }),
      });
    case "run-iam-get":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.run.services.getIamPolicy" },
        url: fixedUrl({ base: RUN, path: `${path}:getIamPolicy`, query: { "options.requestedPolicyVersion": "3" } }),
      });
    case "run-iam-set":
      return built({
        shape: {
          body: { policy: request.policy },
          effect: "write",
          method: "POST",
          operation: "gcp.run.services.setIamPolicy",
        },
        url: fixedUrl({ base: RUN, path: `${path}:setIamPolicy`, query: {} }),
      });
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

/**
 * A Secret Manager call on one secret or one of its versions.
 *
 * @param request the Secret Manager call
 * @returns the request, or the refusal
 */
// max-lines-exempt: a per-kind dispatch whose whole body is one closed request per Secret Manager kind; a split would put a kind's URL and method away from its case
export function buildSecret({
  request,
}: {
  request: RequestOf<
    | "secret-get"
    | "secret-create"
    | "secret-version-list"
    | "secret-version-add"
    | "secret-version-disable"
    | "secret-version-get"
    | "secret-version-access"
    | "secret-iam-get"
    | "secret-iam-set"
  >;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  const version = "version" in request ? request.version : undefined;
  const checked = checkAll({
    names: [
      ["project", request.project],
      ["secret", request.secret],
      ["secret-version", version],
    ],
  });
  if (checked.isErr()) {
    return err(checked.error);
  }
  const path = `/projects/${request.project}/secrets/${request.secret}`;
  // A request naming no version is a secret-level one, which never reads `versionPath`.
  const versionPath = version === undefined ? `${path}/versions/` : `${path}/versions/${version}`;
  switch (request.kind) {
    case "secret-get":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.secretmanager.secrets.get" },
        url: fixedUrl({ base: SECRET_MANAGER, path, query: {} }),
      });
    case "secret-create":
      return built({
        shape: {
          body: { replication: { automatic: {} } },
          effect: "write",
          method: "POST",
          operation: "gcp.secretmanager.secrets.create",
        },
        url: fixedUrl({
          base: SECRET_MANAGER,
          path: `/projects/${request.project}/secrets`,
          query: { secretId: request.secret },
        }),
      });
    case "secret-version-list":
      if (request.pageToken !== undefined && !PAGE_TOKEN.test(request.pageToken)) {
        return err(GcpDoorErrors.requestRefused({ what: path, why: "the page token is not an opaque token" }));
      }
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.secretmanager.versions.list" },
        url: fixedUrl({ base: SECRET_MANAGER, path: `${path}/versions`, query: { pageToken: request.pageToken } }),
      });
    case "secret-version-add":
      if (!BASE64.test(request.data) || !CRC32C.test(request.dataCrc32c)) {
        return err(
          GcpDoorErrors.requestRefused({ what: `${path}:addVersion`, why: "the payload is not checked base64" }),
        );
      }
      return built({
        shape: {
          body: { payload: { data: request.data, dataCrc32c: request.dataCrc32c } },
          effect: "write",
          method: "POST",
          operation: "gcp.secretmanager.secrets.addVersion",
        },
        url: fixedUrl({ base: SECRET_MANAGER, path: `${path}:addVersion`, query: {} }),
      });
    case "secret-version-disable":
      return built({
        shape: {
          body: { etag: request.etag },
          effect: "write",
          method: "POST",
          operation: "gcp.secretmanager.versions.disable",
        },
        url: fixedUrl({ base: SECRET_MANAGER, path: `${versionPath}:disable`, query: {} }),
      });
    case "secret-version-get":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.secretmanager.versions.get" },
        url: fixedUrl({ base: SECRET_MANAGER, path: versionPath, query: {} }),
      });
    case "secret-version-access":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.secretmanager.versions.access" },
        url: fixedUrl({ base: SECRET_MANAGER, path: `${versionPath}:access`, query: {} }),
      });
    case "secret-iam-get":
      return built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.secretmanager.secrets.getIamPolicy" },
        url: fixedUrl({
          base: SECRET_MANAGER,
          path: `${path}:getIamPolicy`,
          query: { "options.requestedPolicyVersion": "3" },
        }),
      });
    case "secret-iam-set":
      return built({
        shape: {
          body: { policy: request.policy },
          effect: "write",
          method: "POST",
          operation: "gcp.secretmanager.secrets.setIamPolicy",
        },
        url: fixedUrl({ base: SECRET_MANAGER, path: `${path}:setIamPolicy`, query: {} }),
      });
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}
