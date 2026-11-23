/**
 * The integration a hand step touches, named from the credential register — what the Queue card's right-hand tag
 * draws as `integration=<name>` (a name like Google Admin or Google SecOps). Derived from the step's own registry entry, never a word the fleet picks: the
 * step has the owner store a secret, that secret is a row of `src/secrets/registry.ts`, and the row names its platform.
 *
 * Pure: a step and the register in, a name or nothing out.
 */
import { credentialsByName } from "../secrets/registry.js";

import { secretsSetNames } from "./secretName.js";
import type { HandStep } from "./step.js";

/** The suffix a register platform gives a Google door's own name: `Google (SecOps door)` is Google SecOps. */
const DOOR_SUFFIX = / door$/u;

/**
 * A register `platform` as the name a card shows. A parenthetical naming a door joins the product
 * (`Google (Admin door)` → `Google Admin`); any other parenthetical or dash-led remark is prose about the row, so it
 * is dropped (`Supabase (the local store)` → `Supabase`, `the operator's password manager — …` → `the operator's password
 * manager`).
 *
 * @param platform the register's platform string
 * @returns the short name
 */
export function integrationName({ platform }: { platform: string }): string {
  const match = /^([^(]+?) \(([^)]+)\)/u.exec(platform);
  const product = match?.[1];
  const door = match?.[2];
  if (product !== undefined && door !== undefined && DOOR_SUFFIX.test(door)) {
    return `${product} ${door.replace(DOOR_SUFFIX, "")}`;
  }
  const [base] = platform.split(/ \(| — /u);
  if (base === undefined) {
    return platform;
  }
  return base;
}

/**
 * The integration a step touches: the platform of the first secret it has the owner store that the register holds.
 *
 * @param step the open step
 * @returns the integration's name, or `undefined` when the step stores no registered secret
 */
export function integrationOfStep({ step }: { step: HandStep }): string | undefined {
  const register = credentialsByName();
  for (const name of secretsSetNames({ step })) {
    const spec = register.get(name);
    if (spec !== undefined) {
      return integrationName({ platform: spec.platform });
    }
  }
  return undefined;
}
