/**
 * Adding one IAM member to a policy, and proving the result takes nothing away. Pure.
 *
 * Google's `setIamPolicy` REPLACES the whole policy, so "add a binding" is a read-modify-write: read the policy
 * with its `etag`, add exactly one member, write it back carrying the same `etag` so a policy edited in between
 * is refused by Google rather than overwritten. The door's additive rail is that the written policy is a strict
 * superset of the one read — every binding, condition, member, audit config and the version kept, one member
 * added — and {@link isStrictSuperset} checks exactly that before a set is ever built.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { bindingsOf, membersOf } from "./lists.js";
import type { IamBinding, IamPolicy } from "./wire.js";

/**
 * The policy with `member` added to the UNCONDITIONAL binding for `role`, or a new binding when there is none.
 * A conditional binding for the same role is left exactly as it is: adding to it would grant only under its
 * condition, which is not what was asked for.
 *
 * @param policy the policy as just read
 * @param role the role to grant
 * @param member the member to grant it to
 * @returns the policy to write, `NO_CHANGE` when the member already holds the role unconditionally, or
 *   `REQUEST_REFUSED` when the read carried no etag to write back against
 */
export function addIamMember({
  policy,
  role,
  member,
}: {
  policy: IamPolicy;
  role: string;
  member: string;
}): Result<IamPolicy, GcpDoorError> {
  if (policy.etag === undefined) {
    return err(
      GcpDoorErrors.requestRefused({
        what: `${role} for ${member}`,
        why: "the policy read carried no etag, so a write could overwrite a concurrent edit",
      }),
    );
  }
  const bindings = bindingsOf({ policy });
  const index = bindings.findIndex((binding) => binding.role === role && binding.condition === undefined);
  if (index === -1) {
    return ok({ ...policy, bindings: [...bindings, { members: [member], role }] });
  }
  const existing = bindings[index]!;
  const members = membersOf({ binding: existing });
  if (members.includes(member)) {
    return err(GcpDoorErrors.noChange({ what: `${member} already holds ${role}` }));
  }
  const widened: IamBinding = { ...existing, members: [...members, member] };
  return ok({ ...policy, bindings: bindings.map((binding, at) => (at === index ? widened : binding)) });
}

/** One binding's identity: its role and its condition, so a conditional grant never matches an unconditional one. */
function bindingKey({ binding }: { binding: IamBinding }): string {
  return JSON.stringify([binding.role, unsetFieldAsNull({ key: "condition", record: binding })]);
}

/** Every `(binding, member)` pair a policy grants, as comparable strings. */
function grants({ policy }: { policy: IamPolicy }): ReadonlySet<string> {
  const pairs = new Set<string>();
  for (const binding of bindingsOf({ policy })) {
    for (const member of membersOf({ binding })) {
      pairs.add(JSON.stringify([bindingKey({ binding }), member]));
    }
  }
  return pairs;
}

/**
 * Whether `after` keeps everything `before` grants and adds exactly one grant, with the etag, version and audit
 * configs unchanged.
 *
 * @param before the policy as read
 * @param after the policy about to be written
 * @returns true only for a strict, single-grant superset
 */
export function isStrictSuperset({ before, after }: { before: IamPolicy; after: IamPolicy }): boolean {
  if (before.etag !== after.etag || before.version !== after.version) {
    return false;
  }
  if (JSON.stringify(before.auditConfigs) !== JSON.stringify(after.auditConfigs)) {
    return false;
  }
  const kept = grants({ policy: before });
  const now = grants({ policy: after });
  const lost = [...kept].filter((pair) => !now.has(pair));
  return lost.length === 0 && now.size === kept.size + 1;
}
