/**
 * The no-silent-fallback gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic, the debt list and their exports live in `noSilentFallback.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNoSilentFallback } from "./noSilentFallback.js";

await runGateEntry({ run: runNoSilentFallback });
