/**
 * Planning a Cloud Run deploy: create a service that does not exist, patch one that does, and grant the public
 * invoker when asked. The classification rule and the digest are `./plan.ts`'s; this file only plans the steps.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { addIamMember } from "./iam.js";
import { containersOf, envOf } from "./lists.js";
import {
  type GcpWritePlan,
  type GcpWriteStep,
  grantEtag,
  planOrNoChange,
  RUN_INVOKER,
  runServiceName,
} from "./plan.js";
import { cutMessage, cutValues, literalEnvValues, type UnprintableValue } from "./redact.js";
import type { RunServiceRef } from "./request.js";
import type { IamPolicy, RunService, RunTemplate } from "./wire.js";

/** A `run deploy` invocation. */
export interface RunDeployOptions extends RunServiceRef {
  readonly image: string;
  readonly serviceAccount: string | undefined;
  readonly removeEnv: readonly string[];
  readonly allowUnauthenticated: boolean;
}

/**
 * The template a patch writes: the one read, with the image, service account and env removals applied and every
 * other key carried verbatim. A service with more than one container is refused — which one to deploy to is a
 * question this door does not guess at.
 *
 * @param template the template as read
 * @param options the deploy
 * @returns the template to write and whether it differs from the one read, or `INPUT_INVALID`
 */
export function patchedTemplate({
  template,
  options,
}: {
  template: RunTemplate;
  options: RunDeployOptions;
}): Result<{ readonly template: RunTemplate; readonly changed: readonly string[] }, GcpDoorError> {
  const containers = containersOf({ template });
  const [container, ...others] = containers;
  if (container === undefined || others.length > 0) {
    return err(
      GcpDoorErrors.inputInvalid({
        why: `the service runs ${String(containers.length)} containers; the door deploys to a service with exactly one`,
      }),
    );
  }
  const env = envOf({ container });
  const missing = options.removeEnv.filter((key) => !env.some((entry) => entry.name === key));
  if (missing.length > 0) {
    return err(
      GcpDoorErrors.inputInvalid({ why: `--remove-env names no variable on the service: ${missing.join(", ")}` }),
    );
  }
  const changed: string[] = [];
  if (container.image !== options.image) {
    changed.push(`image ${container.image} → ${options.image}`);
  }
  if (options.serviceAccount !== undefined && template.serviceAccount !== options.serviceAccount) {
    changed.push(`service account ${String(template.serviceAccount)} → ${options.serviceAccount}`);
  }
  if (options.removeEnv.length > 0) {
    changed.push(`remove env ${options.removeEnv.join(", ")}`);
  }
  const keptEnv = env.filter((entry) => !options.removeEnv.includes(entry.name));
  const nextContainer = {
    ...container,
    image: options.image,
    ...(container.env === undefined ? {} : { env: keptEnv }),
  };
  return ok({
    changed,
    template: {
      ...template,
      containers: [nextContainer],
      ...(options.serviceAccount === undefined ? {} : { serviceAccount: options.serviceAccount }),
    },
  });
}

/** What every step planner below shares: the deploy, its target, and the values a print of it must cut. */
interface DeployContext {
  readonly options: RunDeployOptions;
  readonly target: string;
  readonly ref: RunServiceRef;
  readonly values: readonly UnprintableValue[];
}

/**
 * Plan a deploy: create the service when it does not exist, patch it when it does and something differs, and
 * grant the public invoker when `--allow-unauthenticated` asks and the policy lacks it.
 *
 * @param options the deploy
 * @param service the service as read, or null when Google answered 404
 * @param policy the service's IAM policy as read, or null when the service does not exist or no grant was asked
 * @returns the plan, `NO_CHANGE`, or `INPUT_INVALID`
 */
export function planRunDeploy({
  options,
  service,
  policy,
}: {
  options: RunDeployOptions;
  service: RunService | null;
  policy: IamPolicy | null;
}): Result<GcpWritePlan, GcpDoorError> {
  const target = runServiceName({ ref: options });
  const context: DeployContext = {
    options,
    ref: { project: options.project, region: options.region, service: options.service },
    target,
    // A summary and the read are printed and digested as they stand, so any literal env value of the service as
    // read is cut out of them here: nothing stops one being byte-equal to its image or its service account.
    values: service === null ? [] : literalEnvValues({ template: service.template }),
  };
  const serviceSteps = service === null ? createSteps({ context }) : patchSteps({ context, service });
  if (serviceSteps.isErr()) {
    return err(serviceSteps.error);
  }
  const grant = grantSteps({ context, policy, service });
  if (grant.isErr()) {
    return err(grant.error);
  }
  const steps = [...serviceSteps.value, ...grant.value];
  return planOrNoChange({
    already: cutValues({ text: `${target} already runs ${options.image} as asked`, values: context.values }),
    plan: {
      command: "run deploy",
      project: options.project,
      read: deployRead({ policy, service, values: context.values }),
      steps,
      target,
      unprintable: context.values,
    },
  });
}

/** The one step creating a service that does not exist, which no `--remove-env` can name a variable of. */
function createSteps({ context }: { context: DeployContext }): Result<readonly GcpWriteStep[], GcpDoorError> {
  const { options, ref, target } = context;
  if (options.removeEnv.length > 0) {
    return err(GcpDoorErrors.inputInvalid({ why: "--remove-env needs a service that exists; this one does not" }));
  }
  const template: RunTemplate = {
    containers: [{ image: options.image }],
    ...(options.serviceAccount === undefined ? {} : { serviceAccount: options.serviceAccount }),
  };
  return ok([
    {
      action: { kind: "send", request: { kind: "run-service-create", ...ref, template } },
      classification: "additive",
      id: "create-service",
      summary: `create Cloud Run service ${target} running ${options.image}`,
    },
  ]);
}

/** The patch of an existing service, or no step when nothing the deploy names differs from what was read. */
function patchSteps({
  context,
  service,
}: {
  context: DeployContext;
  service: RunService;
}): Result<readonly GcpWriteStep[], GcpDoorError> {
  const { options, ref, target, values } = context;
  const patched = patchedTemplate({ options, template: service.template });
  if (patched.isErr()) {
    // It quotes the caller's `--remove-env` names back, and the env values are already read.
    return err(cutMessage({ error: patched.error, values }));
  }
  if (patched.value.changed.length === 0) {
    return ok([]);
  }
  return ok([
    {
      action: {
        kind: "send",
        request: { etag: service.etag, kind: "run-service-patch", ...ref, template: patched.value.template },
      },
      classification: "edit-existing",
      id: "patch-service",
      summary: cutValues({
        text: `deploy a new revision of EXISTING service ${target}, and traffic moves to it: ${patched.value.changed.join("; ")}`,
        values,
      }),
    },
  ]);
}

/** The public-invoker grant, when `--allow-unauthenticated` asks and the policy read does not already hold it. */
function grantSteps({
  context,
  policy,
  service,
}: {
  context: DeployContext;
  policy: IamPolicy | null;
  service: RunService | null;
}): Result<readonly GcpWriteStep[], GcpDoorError> {
  const { options, ref, target } = context;
  if (!options.allowUnauthenticated) {
    return ok([]);
  }
  if (policy !== null) {
    // A policy that was read is merged at plan time too, so one already granting is no step, and one Google
    // answered without an etag is refused here: a grant planned against it would carry no etag to hold the send to.
    const merged = addIamMember({ member: "allUsers", policy, role: RUN_INVOKER });
    if (merged.isErr()) {
      return merged.error.code === "NO_CHANGE" ? ok([]) : err(merged.error);
    }
  }
  const isNew = service === null;
  return ok([
    {
      action: {
        kind: "grant",
        member: "allUsers",
        readEtag: policy === null ? null : grantEtag({ policy }),
        resource: { kind: "run", ref },
        role: RUN_INVOKER,
      },
      classification: isNew ? "additive" : "edit-existing",
      id: "grant-public-invoker",
      summary: `grant ${RUN_INVOKER} to allUsers on ${isNew ? "the new" : "EXISTING"} service ${target}, making it public`,
    },
  ]);
}

/** The read a deploy's plan prints and digests, every field that could carry an env value cut. */
function deployRead({
  service,
  policy,
  values,
}: {
  service: RunService | null;
  policy: IamPolicy | null;
  values: readonly UnprintableValue[];
}): GcpWritePlan["read"] {
  const policyEtag = policy === null ? null : grantEtag({ policy });
  if (service === null) {
    return { etag: null, exists: false, image: null, policyEtag, serviceAccount: null };
  }
  return {
    etag: service.etag,
    exists: true,
    image: printableOrNull({ text: imageOf({ service }), values }),
    policyEtag,
    serviceAccount: printableOrNull({
      text: unsetFieldAsNull({ key: "serviceAccount", record: service.template }),
      values,
    }),
  };
}

/** A read field with every unprintable value cut out of it, null kept null. */
function printableOrNull({
  text,
  values,
}: {
  text: string | null;
  values: readonly UnprintableValue[];
}): string | null {
  return text === null ? null : cutValues({ text, values });
}

/** The first container's image, or null for a service with none. */
function imageOf({ service }: { service: RunService }): string | null {
  const first = service.template.containers?.[0];
  return first === undefined ? null : first.image;
}
