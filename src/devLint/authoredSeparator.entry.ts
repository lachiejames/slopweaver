/**
 * The authored-separator gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `authoredSeparator.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runAuthoredSeparator } from "./authoredSeparator.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAuthoredSeparator });
