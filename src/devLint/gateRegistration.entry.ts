/**
 * The gate-registration entry point — nothing but the top-level invocation (run by `dev lint`). The logic
 * and its exports live in `gateRegistration.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard. It is itself subject to the check it runs.
 */
import { runGateEntry } from "./gateEntry.js";
import { runGateRegistration } from "./gateRegistration.js";

await runGateEntry({ run: runGateRegistration });
