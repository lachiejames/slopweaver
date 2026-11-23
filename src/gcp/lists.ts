/**
 * The repeated fields Google omits when they are empty. Proto3 JSON drops an empty list rather than sending `[]`,
 * so each absence here is BY DESIGN and means none: a template with no containers, a container with no env, a
 * policy that grants nothing, a binding with no members. Every other optional field is read where it is used.
 */

import type { IamBinding, IamPolicy, RunTemplate } from "./wire.js";

/** One container of a Cloud Run template. */
export type RunContainer = NonNullable<RunTemplate["containers"]>[number];

/** One env entry of a Cloud Run container. */
type RunEnvEntry = NonNullable<RunContainer["env"]>[number];

/**
 * A template's containers; a template Google sends with none omits `containers`.
 *
 * @returns the containers, in template order
 */
export function containersOf({ template }: { template: RunTemplate }): readonly RunContainer[] {
  if (template.containers === undefined) {
    return [];
  }
  return template.containers;
}

/**
 * A container's env entries; a container setting none omits `env`.
 *
 * @returns the env entries, in container order
 */
export function envOf({ container }: { container: RunContainer }): readonly RunEnvEntry[] {
  if (container.env === undefined) {
    return [];
  }
  return container.env;
}

/**
 * A policy's bindings; a policy granting nothing omits `bindings`.
 *
 * @returns the bindings, in policy order
 */
export function bindingsOf({ policy }: { policy: IamPolicy }): readonly IamBinding[] {
  if (policy.bindings === undefined) {
    return [];
  }
  return policy.bindings;
}

/**
 * A binding's members; a binding left with none omits `members`.
 *
 * @returns the members, in binding order
 */
export function membersOf({ binding }: { binding: IamBinding }): readonly string[] {
  if (binding.members === undefined) {
    return [];
  }
  return binding.members;
}
