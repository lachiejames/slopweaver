/**
 * Performing one planned IAM grant as a read-merge-write: read the policy, refuse it if it moved since the plan,
 * add exactly one member, prove the result a strict superset of what was read, and set it carrying the read etag.
 * One step of `./execute.ts`'s `performPlan`, split out because the grant is the only step that reads before it
 * writes.
 */
import { err, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { addIamMember, isStrictSuperset } from "./iam.js";
import type { GcpStepAction } from "./plan.js";
import { cutMessage, literalEnvValues } from "./redact.js";
import type { GcpDoorRequest } from "./request.js";
import { callGcp, type GcpDoorSend } from "./transport.js";
import { IAM_POLICY, RUN_SERVICE } from "./wire.js";

/**
 * Grant one member: read the policy, refuse it if it moved since the plan, add the member, prove nothing else
 * changed, and set it carrying the read etag.
 *
 * @param send the sender
 * @param action the grant
 * @returns one line naming the grant, `NO_CHANGE` if the member arrived meanwhile, or the refusal
 */
export async function performGrant({
  send,
  action,
}: {
  send: GcpDoorSend;
  action: Extract<GcpStepAction, { kind: "grant" }>;
}): Promise<Result<string, GcpDoorError>> {
  if (action.readEtag === null && action.resource.kind === "run") {
    // No etag to compare means the plan created this service a step ago. Another writer's deploy in between would
    // make this additive grant publish THEIR revision, so it goes ahead only on the generation a create leaves.
    // That narrows the window to this read and the set below; `setIamPolicy` takes no generation precondition.
    const service = await callGcp({
      boundary: RUN_SERVICE,
      request: { kind: "run-service-get", ...action.resource.ref },
      send,
    });
    if (service.isErr()) {
      return err(service.error);
    }
    // The plan read no env for a service it was creating, but this read just did, so every failure from here on —
    // the generation refusal included — is cut against what it holds.
    const values = literalEnvValues({ template: service.value.template });
    if (service.value.generation !== "1") {
      return err(
        cutMessage({
          error: GcpDoorErrors.requestRefused({
            what: `${action.role} for ${action.member}`,
            why: `the service this plan created is at generation ${String(service.value.generation)}, so another write reached it first — preview again`,
          }),
          values,
        }),
      );
    }
    return (await grantOnPolicy({ action, send })).mapErr((error) => cutMessage({ error, values }));
  }
  return grantOnPolicy({ action, send });
}

/** A grant's policy read, its strict-superset check and its write, after any generation check has passed. */
async function grantOnPolicy({
  send,
  action,
}: {
  send: GcpDoorSend;
  action: Extract<GcpStepAction, { kind: "grant" }>;
}): Promise<Result<string, GcpDoorError>> {
  const get: GcpDoorRequest =
    action.resource.kind === "run"
      ? { kind: "run-iam-get", ...action.resource.ref }
      : { kind: "secret-iam-get", ...action.resource.ref };
  const read = await callGcp({ boundary: IAM_POLICY, request: get, send });
  if (read.isErr()) {
    return err(read.error);
  }
  const before = read.value;
  if (action.readEtag !== null && before.etag !== action.readEtag) {
    return err(
      GcpDoorErrors.requestRefused({
        what: `${action.role} for ${action.member}`,
        why: "the policy changed since it was planned against — preview again",
      }),
    );
  }
  const after = addIamMember({ member: action.member, policy: before, role: action.role });
  if (after.isErr()) {
    return err(after.error);
  }
  if (!isStrictSuperset({ after: after.value, before })) {
    return err(
      GcpDoorErrors.requestRefused({
        what: `${action.role} for ${action.member}`,
        why: "the policy to write is not a strict superset of the one read",
      }),
    );
  }
  const set: GcpDoorRequest =
    action.resource.kind === "run"
      ? { kind: "run-iam-set", ...action.resource.ref, policy: after.value }
      : { kind: "secret-iam-set", ...action.resource.ref, policy: after.value };
  return (await callGcp({ boundary: IAM_POLICY, request: set, send })).map(
    () => `granted ${action.role} to ${action.member}`,
  );
}
