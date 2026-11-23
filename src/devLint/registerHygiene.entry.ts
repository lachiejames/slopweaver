/**
 * The register-hygiene gate entry point — nothing but the top-level invocation (run by `dev lint`). The check
 * logic + its exports live in `registerHygiene.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRegisterHygiene } from "./registerHygiene.js";

await runGateEntry({ run: runRegisterHygiene });
