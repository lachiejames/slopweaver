/**
 * Planning the project-level writes, each one resource that either exists or is created: a service account, an
 * API enabled, a Docker repository. Every one is additive by construction — an existing resource is `NO_CHANGE`,
 * never touched.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import type { GcpWritePlan } from "./plan.js";

/**
 * Plan a service account create.
 *
 * @param accountId the id before `@`
 * @param exists whether the account already exists
 * @returns the plan, or `NO_CHANGE`
 */
export function planServiceAccountCreate({
  project,
  accountId,
  displayName,
  description,
  exists,
}: {
  project: string;
  accountId: string;
  displayName: string | undefined;
  description: string | undefined;
  exists: boolean;
}): Result<GcpWritePlan, GcpDoorError> {
  const email = serviceAccountEmail({ accountId, project });
  if (exists) {
    return err(GcpDoorErrors.noChange({ what: `${email} already exists` }));
  }
  return ok({
    command: "service-account create",
    project,
    read: { exists },
    steps: [
      {
        action: {
          kind: "send",
          request: {
            accountId,
            kind: "service-account-create",
            project,
            ...(displayName === undefined ? {} : { displayName }),
            ...(description === undefined ? {} : { description }),
          },
        },
        classification: "additive",
        id: "create-service-account",
        summary: `create service account ${email}`,
      },
    ],
    target: `projects/${project}/serviceAccounts/${email}`,
  });
}

/**
 * A user-managed service account's email.
 *
 * @returns `<accountId>@<project>.iam.gserviceaccount.com`
 */
export function serviceAccountEmail({ accountId, project }: { accountId: string; project: string }): string {
  return `${accountId}@${project}.iam.gserviceaccount.com`;
}

/**
 * Plan enabling one API.
 *
 * @param service the API
 * @param state its state as read
 * @returns the plan, or `NO_CHANGE` when it is already enabled
 */
export function planServiceEnable({
  project,
  service,
  state,
}: {
  project: string;
  service: string;
  state: string | null;
}): Result<GcpWritePlan, GcpDoorError> {
  const target = `projects/${project}/services/${service}`;
  if (state === "ENABLED") {
    return err(GcpDoorErrors.noChange({ what: `${service} is already enabled on ${project}` }));
  }
  return ok({
    command: "services enable",
    project,
    read: { state },
    steps: [
      {
        action: { kind: "send", request: { kind: "api-service-enable", project, service } },
        classification: "additive",
        id: "enable",
        summary: `enable ${service} on ${project}`,
      },
    ],
    target,
  });
}

/**
 * Plan a Docker repository create.
 *
 * @param repository the repository id
 * @param exists whether it already exists
 * @returns the plan, or `NO_CHANGE`
 */
export function planRepositoryCreate({
  project,
  region,
  repository,
  description,
  exists,
}: {
  project: string;
  region: string;
  repository: string;
  description: string | undefined;
  exists: boolean;
}): Result<GcpWritePlan, GcpDoorError> {
  const target = `projects/${project}/locations/${region}/repositories/${repository}`;
  if (exists) {
    return err(GcpDoorErrors.noChange({ what: `${target} already exists` }));
  }
  return ok({
    command: "artifacts create",
    project,
    read: { exists },
    steps: [
      {
        action: {
          kind: "send",
          request: {
            kind: "repository-create",
            project,
            region,
            repository,
            ...(description === undefined ? {} : { description }),
          },
        },
        classification: "additive",
        id: "create-repository",
        summary: `create Docker repository ${target}`,
      },
    ],
    target,
  });
}
