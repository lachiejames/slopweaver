/**
 * What one GCP write invocation would do, as steps, each classified ADDITIVE or EDIT-EXISTING, and the digest an
 * approval binds to. Pure: every planner takes what was just read and answers a plan, so the same reads always
 * plan the same steps. The planners themselves live beside this file, one per family: `./planRun.ts`,
 * `./planSecret.ts` and `./planProject.ts`.
 *
 * ## The additive rule is semantic, not provenance
 *
 * The rule: editing existing resources in GCP is where the main risk lies, so the door is expected to be
 * almost entirely additive. A step is ADDITIVE when it only adds — a resource that
 * does not exist yet, a first secret version, an API enabled, one IAM member on top of a policy that keeps every
 * grant it had. It is EDIT-EXISTING when something that already exists behaves differently afterwards:
 *
 * - a deploy onto a service that already exists (its traffic moves to a new revision);
 * - a secret version added beside an ENABLED one (`latest` moves for every reader);
 * - a version disabled (every reader of it breaks);
 * - a PUBLIC member (`allUsers`, `allAuthenticatedUsers`) granted on a resource this invocation did not create.
 *
 * Which tool created the resource is deliberately not the test: raw `gcloud` made the overnight resources, and a
 * door-made resource can come to hold state as valuable as any other. An EDIT-EXISTING step needs
 * `--edit-existing "<why>"` on top of the approval, and that reason rides the door ledger.
 *
 * ## The digest
 *
 * SHA-256 over the canonical JSON of the plan: the command, what was read that the steps depend on (etags,
 * image, versions), and every step's exact request — a secret payload replaced by its SHA-256, so the digest
 * input never holds a byte of it. Anything that moves between the preview and the approved run changes it.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { sha256Hex } from "#lib/hash.js";
import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { addIamMember } from "./iam.js";
import { containersOf } from "./lists.js";
import { cutValuesDeep, type UnprintableValue } from "./redact.js";
import type { GcpDoorRequest, RunServiceRef, SecretRef } from "./request.js";
import type { IamPolicy, RunTemplate } from "./wire.js";

/** Whether a step only adds, or changes how something that exists behaves. */
export type GcpWriteClass = "additive" | "edit-existing";

/** A resource the door can grant on. */
type IamResource =
  { readonly kind: "run"; readonly ref: RunServiceRef } | { readonly kind: "secret"; readonly ref: SecretRef };

/**
 * What one step does. `send` is one fixed request. `grant` is a read-merge-write done at execution: read the
 * policy, refuse it if its etag is not the one planned against (`null`: the resource is created by an earlier
 * step), add the member, prove the superset, set it.
 */
export type GcpStepAction =
  | { readonly kind: "send"; readonly request: GcpDoorRequest }
  | {
      readonly kind: "grant";
      readonly resource: IamResource;
      readonly role: string;
      readonly member: string;
      readonly readEtag: string | null;
    };

/** One step of a write. */
export interface GcpWriteStep {
  /** Stable within the plan, `create-service`; what a ledger line and a partial-write report name. */
  readonly id: string;
  readonly classification: GcpWriteClass;
  /** One line a reader approves on. Never a secret byte. */
  readonly summary: string;
  readonly action: GcpStepAction;
}

/** Every write the door performs, as the CLI names it. */
type GcpWriteCommand =
  | "run deploy"
  | "secret create"
  | "secret add-version"
  | "secret disable-version"
  | "secret add-iam-policy-binding"
  | "service-account create"
  | "services enable"
  | "artifacts create";

/** One planned write. */
export interface GcpWritePlan {
  readonly command: GcpWriteCommand;
  readonly project: string;
  /** The resource the command is about, as a full name. */
  readonly target: string;
  /** What was read that the steps were planned from — bound into the digest so drift invalidates it. */
  readonly read: Readonly<Record<string, string | number | boolean | null>>;
  readonly steps: readonly GcpWriteStep[];
  /**
   * Every value a print of this plan must cut — a deploy's literal env values, as read. Never digested and never
   * printed: `planView` leaves it out, and `printablePlanView` and the preview cut against it.
   */
  readonly unprintable?: readonly UnprintableValue[];
}

/** The public invoker grant `--allow-unauthenticated` asks for. */
export const RUN_INVOKER = "roles/run.invoker";

/**
 * A Cloud Run service's full name.
 *
 * @returns `projects/<project>/locations/<region>/services/<service>`
 */
export function runServiceName({ ref }: { ref: RunServiceRef }): string {
  return `projects/${ref.project}/locations/${ref.region}/services/${ref.service}`;
}

/**
 * A secret's full name.
 *
 * @returns `projects/<project>/secrets/<secret>`
 */
export function secretName({ ref }: { ref: SecretRef }): string {
  return `projects/${ref.project}/secrets/${ref.secret}`;
}

/**
 * Whether a policy already grants `member` the role unconditionally.
 *
 * @param policy the policy as read
 * @returns true when there is nothing to add
 */
export function policyGrants({ policy, role, member }: { policy: IamPolicy; role: string; member: string }): boolean {
  return addIamMember({ member, policy, role }).match(
    () => false,
    (error) => error.code === "NO_CHANGE",
  );
}

/**
 * A plan with at least one step, or `NO_CHANGE` naming what is already true.
 *
 * @param already what a plan with no steps reports as already true
 * @returns the plan, or `NO_CHANGE`
 */
export function planOrNoChange({
  plan,
  already,
}: {
  plan: GcpWritePlan;
  already: string;
}): Result<GcpWritePlan, GcpDoorError> {
  return plan.steps.length === 0 ? err(GcpDoorErrors.noChange({ what: already })) : ok(plan);
}

/**
 * A policy's etag for a grant; an etagless policy has already been refused by {@link addIamMember}.
 *
 * @returns the etag, or null when the policy carries none
 */
export function grantEtag({ policy }: { policy: IamPolicy }): string | null {
  return unsetFieldAsNull({ key: "etag", record: policy });
}

/**
 * A template with every env var's literal value replaced by its SHA-256, so a plain-text credential in a
 * service's env is bound by the digest without being printed.
 *
 * @param template the template a create or patch sends
 * @returns the template, safe to print
 */
function templateView({ template }: { template: RunTemplate }): Readonly<Record<string, unknown>> {
  return {
    ...template,
    containers: containersOf({ template }).map((container) => ({
      ...container,
      ...(container.env === undefined
        ? {}
        : {
            env: container.env.map((entry) => ({
              ...entry,
              ...(entry.value === undefined
                ? {}
                : { value: `sha256:${sha256Hex({ bytes: stableStringify({ value: entry.value }) })}` }),
            })),
          }),
    })),
  };
}

/** One request as the digest and `--json` see it. */
function requestView({ request }: { request: GcpDoorRequest }): Readonly<Record<string, unknown>> {
  switch (request.kind) {
    case "secret-version-add": {
      const { data, ...kept } = request;
      return { ...kept, dataSha256: sha256Hex({ bytes: Buffer.from(data, "base64") }) };
    }
    case "run-service-create":
    case "run-service-patch":
      return { ...request, template: templateView({ template: request.template }) };
    case "run-service-get":
    case "run-iam-get":
    case "run-iam-set":
    case "secret-get":
    case "secret-create":
    case "secret-version-list":
    case "secret-version-disable":
    case "secret-version-get":
    case "secret-version-access":
    case "secret-iam-get":
    case "secret-iam-set":
    case "service-account-get":
    case "service-account-create":
    case "api-service-get":
    case "api-service-enable":
    case "repository-get":
    case "repository-create":
    case "operation-get":
      return { ...request };
  }
}

/**
 * The plan as the digest and `--json` see it: a secret payload's base64 replaced by its SHA-256, and every
 * env var value in a template by its SHA-256 — each still bound, neither printed.
 *
 * @returns a value safe to hash, print or record
 */
export function planView({ plan }: { plan: GcpWritePlan }): Readonly<Record<string, unknown>> {
  // Named field by field rather than spread, so `unprintable` can never reach the digest or a print.
  return {
    command: plan.command,
    project: plan.project,
    read: plan.read,
    steps: plan.steps.map((step) =>
      step.action.kind === "send"
        ? { ...step, action: { ...step.action, request: requestView({ request: step.action.request }) } }
        : step,
    ),
    target: plan.target,
  };
}

/**
 * Every value a print of this plan must cut.
 *
 * @returns the plan's unprintable values, none for a plan that carries none
 */
export function planUnprintable({ plan }: { plan: GcpWritePlan }): readonly UnprintableValue[] {
  // A plan reading nothing that must not print omits `unprintable`.
  if (plan.unprintable === undefined) {
    return [];
  }
  return plan.unprintable;
}

/**
 * The plan as `--json` prints it: `planView` with every unprintable value then cut out of every string in it, since
 * a literal env value can be byte-equal to any other field — the image a deploy asks for included.
 *
 * @returns the document `--json` prints
 */
export function printablePlanView({ plan }: { plan: GcpWritePlan }): unknown {
  return cutValuesDeep({ document: planView({ plan }), values: planUnprintable({ plan }) });
}

/**
 * The digest an approval of this plan carries.
 *
 * @returns `gcp-` and the first 16 hex characters of the SHA-256 of its canonical view
 */
export function gcpWriteDigest({ plan }: { plan: GcpWritePlan }): string {
  return `gcp-${sha256Hex({ bytes: stableStringify({ value: planView({ plan }) }) }).slice(0, 16)}`;
}

/**
 * Whether any step of the plan edits something that already exists.
 *
 * @returns the edit-existing steps, in order
 */
export function editExistingSteps({ plan }: { plan: GcpWritePlan }): readonly GcpWriteStep[] {
  return plan.steps.filter((step) => step.classification === "edit-existing");
}
