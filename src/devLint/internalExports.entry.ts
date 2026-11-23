/**
 * The internal-exports gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `internalExports.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runInternalExports } from "./internalExports.js";

await runGateEntry({ run: runInternalExports });
