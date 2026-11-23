/**
 * The named-object-params gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `namedObjectParams.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNamedObjectParams } from "./namedObjectParamsRun.js";

await runGateEntry({ run: runNamedObjectParams });
