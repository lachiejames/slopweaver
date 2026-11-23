/**
 * The value lists `slopweaver proposal`'s register verbs quote in their usage lines, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/proposal.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

import {
  REGISTER_FEEDBACK_KINDS,
  REGISTER_STATUSES,
  SETTABLE_REGISTER_STATUSES,
} from "../../../outbound/proposal/register/events.js";

/** The `<a|b|c>` fragment a usage line and a refusal both quote, so neither can drift from the enum. */
export const SETTABLE_STATUS_LIST: string = SETTABLE_REGISTER_STATUSES.join("|");

/** Every folded status, pipe-joined — what `list --status` accepts. */
export const REGISTER_STATUS_LIST: string = REGISTER_STATUSES.join("|");

/** Every feedback kind, pipe-joined. */
export const FEEDBACK_KIND_LIST: string = REGISTER_FEEDBACK_KINDS.join("|");
