/**
 * The reads a GCP write is PLANNED from. Effectful only in that it sends; every decision is a pure planner
 * (`planRun.ts`, `planSecret.ts`, `planProject.ts`), so a preview and the approved run that repeats it plan from
 * the same code. The describe and access reads that stand on their own are `describe.ts`'s.
 *
 * A 404 on a read a write plans from is an answer ("it does not exist yet"), not a failure, and becomes `null`
 * here; on a describe it stays `NOT_FOUND`.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { Boundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";
import { listSecretVersions } from "./describe.js";
import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import type { GcpWritePlan } from "./plan.js";
import {
  planRepositoryCreate,
  planServiceAccountCreate,
  planServiceEnable,
  serviceAccountEmail,
} from "./planProject.js";
import { planRunDeploy, type RunDeployOptions } from "./planRun.js";
import {
  payloadUnprintable,
  planSecretAddVersion,
  planSecretBinding,
  planSecretCreate,
  planSecretDisableVersion,
} from "./planSecret.js";
import { cutMessage, literalEnvValues } from "./redact.js";
import type { GcpDoorRequest, RunServiceRef, SecretRef } from "./request.js";
import type { EncodedSecretPayload } from "./secretPayload.js";
import { callGcp, type GcpDoorSend } from "./transport.js";
import {
  API_SERVICE,
  IAM_POLICY,
  type IamPolicy,
  REPOSITORY,
  RUN_SERVICE,
  SECRET,
  SECRET_VERSION,
  SERVICE_ACCOUNT,
  type SecretVersion,
} from "./wire.js";

/** Every write the door plans, as the CLI parsed it. */
export type GcpWriteOptions =
  | ({ readonly command: "run deploy" } & RunDeployOptions)
  | ({ readonly command: "secret create"; readonly payload: EncodedSecretPayload | undefined } & SecretRef)
  | ({ readonly command: "secret add-version"; readonly payload: EncodedSecretPayload } & SecretRef)
  | ({ readonly command: "secret disable-version"; readonly version: string } & SecretRef)
  | ({ readonly command: "secret add-iam-policy-binding"; readonly role: string; readonly member: string } & SecretRef)
  | {
      readonly command: "service-account create";
      readonly project: string;
      readonly accountId: string;
      readonly displayName: string | undefined;
      readonly description: string | undefined;
    }
  | { readonly command: "services enable"; readonly project: string; readonly service: string }
  | {
      readonly command: "artifacts create";
      readonly project: string;
      readonly region: string;
      readonly repository: string;
      readonly description: string | undefined;
    };

/**
 * One read, a 404 answered as `null`.
 *
 * @param send the sender
 * @param request the read
 * @param boundary its answer's shape
 * @returns the value, null when it does not exist, or the failure
 */
async function readOrNull<T>({
  send,
  request,
  boundary,
}: {
  send: GcpDoorSend;
  request: GcpDoorRequest;
  boundary: Boundary<T>;
}): Promise<Result<T | null, GcpDoorError>> {
  const read = await callGcp({ boundary, request, send });
  if (read.isErr()) {
    return read.error.code === "NOT_FOUND" ? ok(null) : err(read.error);
  }
  return ok(read.value);
}

/** Read a service and, when a public grant is asked for and the service exists, its policy. */
async function planDeploy({
  send,
  options,
}: {
  send: GcpDoorSend;
  options: RunDeployOptions;
}): Promise<Result<GcpWritePlan, GcpDoorError>> {
  const ref: RunServiceRef = { project: options.project, region: options.region, service: options.service };
  const service = await readOrNull({ boundary: RUN_SERVICE, request: { kind: "run-service-get", ...ref }, send });
  if (service.isErr()) {
    return err(service.error);
  }
  let policy: IamPolicy | null = null;
  if (options.allowUnauthenticated && service.value !== null) {
    const read = await callGcp({ boundary: IAM_POLICY, request: { kind: "run-iam-get", ...ref }, send });
    if (read.isErr()) {
      return err(cutMessage({ error: read.error, values: literalEnvValues({ template: service.value.template }) }));
    }
    policy = read.value;
  }
  return planRunDeploy({ options, policy, service: service.value });
}

/**
 * Read what a write depends on and plan it. The preview and the approved run both call this, so the approval
 * is checked against a plan built from reads made moments before the write.
 *
 * @param send the sender
 * @param options the write
 * @returns the plan, `NO_CHANGE`, or the read or input failure
 */
export async function planWrite({
  send,
  options,
}: {
  send: GcpDoorSend;
  options: GcpWriteOptions;
}): Promise<Result<GcpWritePlan, GcpDoorError>> {
  const planned = await planFromReads({ options, send });
  // A payload is read off its file before any request is sent, so every failure from here on — Google's text on a
  // read that never carried it included — is cut against it.
  const values =
    "payload" in options && options.payload !== undefined ? payloadUnprintable({ payload: options.payload }) : [];
  return planned.mapErr((error) => cutMessage({ error, values }));
}

/** `planWrite`'s reads and planner, per command, before its failures are cut. */
// max-lines-exempt: a per-command dispatch whose whole body is one read-then-plan branch per write command; a split would put a command's reads away from its planner
async function planFromReads({
  send,
  options,
}: {
  send: GcpDoorSend;
  options: GcpWriteOptions;
}): Promise<Result<GcpWritePlan, GcpDoorError>> {
  switch (options.command) {
    case "run deploy":
      return planDeploy({ options, send });
    case "secret create": {
      const ref: SecretRef = { project: options.project, secret: options.secret };
      const secret = await readOrNull({ boundary: SECRET, request: { kind: "secret-get", ...ref }, send });
      return secret.andThen((value) => planSecretCreate({ exists: value !== null, payload: options.payload, ref }));
    }
    case "secret add-version": {
      const ref: SecretRef = { project: options.project, secret: options.secret };
      const versions = await listSecretVersions({ ref, send });
      if (versions.isErr()) {
        return err(
          versions.error.code === "NOT_FOUND"
            ? GcpDoorErrors.inputInvalid({
                why: `${ref.secret} does not exist — create it with \`slopweaver gcp secret create\``,
              })
            : versions.error,
        );
      }
      return planSecretAddVersion({ payload: options.payload, ref, versions: versions.value });
    }
    case "secret disable-version": {
      const ref: SecretRef = { project: options.project, secret: options.secret };
      const version = await readVersion({ ref, send, version: options.version });
      return version.andThen((value) => planSecretDisableVersion({ ref, version: value }));
    }
    case "secret add-iam-policy-binding": {
      const ref: SecretRef = { project: options.project, secret: options.secret };
      const policy = await callGcp({ boundary: IAM_POLICY, request: { kind: "secret-iam-get", ...ref }, send });
      return policy.andThen((value) =>
        planSecretBinding({ member: options.member, policy: value, ref, role: options.role }),
      );
    }
    case "service-account create": {
      const email = serviceAccountEmail({ accountId: options.accountId, project: options.project });
      const account = await readOrNull({
        boundary: SERVICE_ACCOUNT,
        request: { email, kind: "service-account-get", project: options.project },
        send,
      });
      return account.andThen((value) =>
        planServiceAccountCreate({
          accountId: options.accountId,
          description: options.description,
          displayName: options.displayName,
          exists: value !== null,
          project: options.project,
        }),
      );
    }
    case "services enable": {
      const service = await callGcp({
        boundary: API_SERVICE,
        request: { kind: "api-service-get", project: options.project, service: options.service },
        send,
      });
      return service.andThen((value) =>
        planServiceEnable({
          project: options.project,
          service: options.service,
          state: unsetFieldAsNull({ key: "state", record: value }),
        }),
      );
    }
    case "artifacts create": {
      const repository = await readOrNull({
        boundary: REPOSITORY,
        request: {
          kind: "repository-get",
          project: options.project,
          region: options.region,
          repository: options.repository,
        },
        send,
      });
      return repository.andThen((value) =>
        planRepositoryCreate({
          description: options.description,
          exists: value !== null,
          project: options.project,
          region: options.region,
          repository: options.repository,
        }),
      );
    }
    default: {
      const unreachable: never = options;
      return unreachable;
    }
  }
}

/**
 * One secret version, `latest` resolved by Google.
 *
 * @param send the sender
 * @param ref the secret
 * @param version a number or `latest`
 * @returns the version, or the failure
 */
async function readVersion({
  send,
  ref,
  version,
}: {
  send: GcpDoorSend;
  ref: SecretRef;
  version: string;
}): Promise<Result<SecretVersion, GcpDoorError>> {
  const read = await callGcp({
    boundary: SECRET_VERSION,
    request: { kind: "secret-version-get", ...ref, version },
    send,
  });
  if (read.isErr() && read.error.code === "NOT_FOUND") {
    return err(GcpDoorErrors.inputInvalid({ why: `${ref.secret} has no version ${version}` }));
  }
  return read;
}
