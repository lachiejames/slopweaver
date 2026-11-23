/**
 * The GCP door's one way to the network: a closed union of operations, each mapped to exactly one method, host
 * and path. No caller supplies a URL, a method, a header or a free query map. Pure.
 *
 * The owner's Application Default Credential carries the `cloud-platform` scope, so the token could write anywhere
 * the owner's roles reach; what this door can do is therefore decided HERE. {@link GcpDoorRequest} names every call the door
 * can make — no member deletes anything, none sets `allowMissing` (which would fold a create into an edit), and
 * none sets a project's own IAM policy — and {@link buildGcpDoorRequest} is the only code that turns one into a
 * URL (the Cloud Run and Secret Manager builders it dispatches to live in `requestRunSecret.ts`, the URL fixing in
 * `requestUrl.ts`). Every name is checked by `names.ts` first, and every built path is checked again after URL
 * normalisation, so a name that slipped a `..` past its pattern still cannot reach a neighbouring collection.
 *
 * Every member says whether it is a READ or a WRITE. A write is sent once and never retried by the transport,
 * because a timeout after a create leaves its outcome unknown, and only the door's own steps (`execute.ts`)
 * send one.
 */
import { err, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { buildRun, buildSecret } from "./requestRunSecret.js";
import { ARTIFACT_REGISTRY, built, checkAll, fixedUrl, IAM, RUN, SERVICE_USAGE } from "./requestUrl.js";
import type { IamPolicy, RunTemplate } from "./wire.js";

/** A Cloud Run service's coordinates. */
export interface RunServiceRef {
  readonly project: string;
  readonly region: string;
  readonly service: string;
}

/** A Secret Manager secret's coordinates. */
export interface SecretRef {
  readonly project: string;
  readonly secret: string;
}

/** Which API a long-running operation belongs to. */
export type GcpOperationProvider = "run" | "serviceusage" | "artifactregistry";

/** Every call the door can make. A member that deletes, or that edits without saying so, is the rail broken. */
export type GcpDoorRequest =
  | ({ readonly kind: "run-service-get" } & RunServiceRef)
  | ({ readonly kind: "run-service-create"; readonly template: RunTemplate } & RunServiceRef)
  | ({ readonly kind: "run-service-patch"; readonly etag: string; readonly template: RunTemplate } & RunServiceRef)
  | ({ readonly kind: "run-iam-get" } & RunServiceRef)
  | ({ readonly kind: "run-iam-set"; readonly policy: IamPolicy } & RunServiceRef)
  | ({ readonly kind: "secret-get" } & SecretRef)
  | ({ readonly kind: "secret-create" } & SecretRef)
  | ({ readonly kind: "secret-version-list"; readonly pageToken?: string } & SecretRef)
  | ({ readonly kind: "secret-version-add"; readonly data: string; readonly dataCrc32c: string } & SecretRef)
  | ({ readonly kind: "secret-version-disable"; readonly version: string; readonly etag: string } & SecretRef)
  | ({ readonly kind: "secret-version-get"; readonly version: string } & SecretRef)
  | ({ readonly kind: "secret-version-access"; readonly version: string } & SecretRef)
  | ({ readonly kind: "secret-iam-get" } & SecretRef)
  | ({ readonly kind: "secret-iam-set"; readonly policy: IamPolicy } & SecretRef)
  | { readonly kind: "service-account-get"; readonly project: string; readonly email: string }
  | {
      readonly kind: "service-account-create";
      readonly project: string;
      readonly accountId: string;
      readonly displayName?: string;
      readonly description?: string;
    }
  | { readonly kind: "api-service-get"; readonly project: string; readonly service: string }
  | { readonly kind: "api-service-enable"; readonly project: string; readonly service: string }
  | { readonly kind: "repository-get"; readonly project: string; readonly region: string; readonly repository: string }
  | {
      readonly kind: "repository-create";
      readonly project: string;
      readonly region: string;
      readonly repository: string;
      readonly description?: string;
    }
  | { readonly kind: "operation-get"; readonly provider: GcpOperationProvider; readonly name: string };

/** One built request: what the transport sends, and nothing it may change. */
export interface BuiltGcpDoorRequest {
  /** The dotted operation name, `gcp.run.services.get` — what a ledger line and a refusal name. */
  readonly operation: string;
  readonly effect: "read" | "write";
  readonly method: "GET" | "POST" | "PATCH";
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>> | undefined;
}

/** One member of {@link GcpDoorRequest}, by its `kind`. */
export type RequestOf<K extends GcpDoorRequest["kind"]> = Extract<GcpDoorRequest, { readonly kind: K }>;

/** A Cloud Run or Artifact Registry operation name; the project may be its id or its number. */
const LOCATION_OPERATION =
  /^projects\/(?:\d{1,20}|[a-z][a-z0-9-]{4,28}[a-z0-9])\/locations\/[a-z]+(?:-[a-z]+)+\d{1,2}\/operations\/[A-Za-z0-9_-]{1,128}$/;

/** A Service Usage operation name, `operations/acat.p2-…`. */
const SERVICE_USAGE_OPERATION = /^operations\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

/** The base URL, project and region of an operation's provider. */
const OPERATION_HOSTS: Readonly<Record<GcpOperationProvider, { readonly base: string; readonly re: RegExp }>> = {
  artifactregistry: { base: ARTIFACT_REGISTRY, re: LOCATION_OPERATION },
  run: { base: RUN, re: LOCATION_OPERATION },
  serviceusage: { base: SERVICE_USAGE, re: SERVICE_USAGE_OPERATION },
};

/**
 * A service account read or create.
 *
 * @param request the IAM call
 * @returns the request, or the refusal
 */
function buildServiceAccount({
  request,
}: {
  request: RequestOf<"service-account-get" | "service-account-create">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  if (request.kind === "service-account-get") {
    return checkAll({
      names: [
        ["project", request.project],
        ["service-account", request.email],
      ],
    }).andThen(() =>
      built({
        shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.iam.serviceAccounts.get" },
        url: fixedUrl({ base: IAM, path: `/projects/${request.project}/serviceAccounts/${request.email}`, query: {} }),
      }),
    );
  }
  return checkAll({
    names: [
      ["project", request.project],
      ["account-id", request.accountId],
      ["text", request.displayName],
      ["text", request.description],
    ],
  }).andThen(() =>
    built({
      shape: {
        body: {
          accountId: request.accountId,
          serviceAccount: {
            ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
            ...(request.description === undefined ? {} : { description: request.description }),
          },
        },
        effect: "write",
        method: "POST",
        operation: "gcp.iam.serviceAccounts.create",
      },
      url: fixedUrl({ base: IAM, path: `/projects/${request.project}/serviceAccounts`, query: {} }),
    }),
  );
}

/**
 * A Service Usage read or enable.
 *
 * @param request the Service Usage call
 * @returns the request, or the refusal
 */
function buildApiService({
  request,
}: {
  request: RequestOf<"api-service-get" | "api-service-enable">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  const path = `/projects/${request.project}/services/${request.service}`;
  const enable = request.kind === "api-service-enable";
  return checkAll({
    names: [
      ["project", request.project],
      ["api-service", request.service],
    ],
  }).andThen(() =>
    built({
      shape: enable
        ? { body: {}, effect: "write", method: "POST", operation: "gcp.serviceusage.services.enable" }
        : { body: undefined, effect: "read", method: "GET", operation: "gcp.serviceusage.services.get" },
      url: fixedUrl({ base: SERVICE_USAGE, path: enable ? `${path}:enable` : path, query: {} }),
    }),
  );
}

/**
 * An Artifact Registry repository read or Docker repository create.
 *
 * @param request the Artifact Registry call
 * @returns the request, or the refusal
 */
function buildRepository({
  request,
}: {
  request: RequestOf<"repository-get" | "repository-create">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  const parent = `/projects/${request.project}/locations/${request.region}/repositories`;
  const description = request.kind === "repository-create" ? request.description : undefined;
  const checked = checkAll({
    names: [
      ["project", request.project],
      ["region", request.region],
      ["repository", request.repository],
      ["text", description],
    ],
  });
  if (checked.isErr()) {
    return err(checked.error);
  }
  if (request.kind === "repository-get") {
    return built({
      shape: { body: undefined, effect: "read", method: "GET", operation: "gcp.artifactregistry.repositories.get" },
      url: fixedUrl({ base: ARTIFACT_REGISTRY, path: `${parent}/${request.repository}`, query: {} }),
    });
  }
  return built({
    shape: {
      body: { format: "DOCKER", ...(description === undefined ? {} : { description }) },
      effect: "write",
      method: "POST",
      operation: "gcp.artifactregistry.repositories.create",
    },
    url: fixedUrl({ base: ARTIFACT_REGISTRY, path: parent, query: { repositoryId: request.repository } }),
  });
}

/**
 * A long-running operation read, its name checked against its provider's own shape.
 *
 * @param request the operation read
 * @returns the request, or the refusal
 */
function buildOperation({
  request,
}: {
  request: RequestOf<"operation-get">;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  const host = OPERATION_HOSTS[request.provider];
  if (!host.re.test(request.name)) {
    return err(GcpDoorErrors.requestRefused({ what: request.name, why: `not a ${request.provider} operation name` }));
  }
  return built({
    shape: { body: undefined, effect: "read", method: "GET", operation: `gcp.${request.provider}.operations.get` },
    url: fixedUrl({ base: host.base, path: `/${request.name}`, query: {} }),
  });
}

/**
 * Turn one operation into the exact request the door sends. Pure, and the ONLY code that builds a URL.
 *
 * An IAM set's policy is not re-checked member by member here: it holds every member the resource already had,
 * in whatever shape Google wrote them, and the one member the door adds was checked when the plan was built and
 * proven the only change by `iam.ts`'s superset check.
 *
 * @param request the operation
 * @returns the method, URL, body and read/write effect, or the refusal naming what was refused
 */
export function buildGcpDoorRequest({
  request,
}: {
  request: GcpDoorRequest;
}): Result<BuiltGcpDoorRequest, GcpDoorError> {
  switch (request.kind) {
    case "run-service-get":
    case "run-service-create":
    case "run-service-patch":
    case "run-iam-get":
    case "run-iam-set":
      return buildRun({ request });
    case "secret-iam-set":
    case "secret-get":
    case "secret-create":
    case "secret-version-list":
    case "secret-version-add":
    case "secret-version-disable":
    case "secret-version-get":
    case "secret-version-access":
    case "secret-iam-get":
      return buildSecret({ request });
    case "service-account-get":
    case "service-account-create":
      return buildServiceAccount({ request });
    case "api-service-get":
    case "api-service-enable":
      return buildApiService({ request });
    case "repository-get":
    case "repository-create":
      return buildRepository({ request });
    case "operation-get":
      return buildOperation({ request });
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}
