/**
 * The hand-rolled-`Result` gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `handRolledResult.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runHandRolledResult } from "./handRolledResult.js";

await runGateEntry({ run: runHandRolledResult });
