/**
 * The sync-child-timeout gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `syncChildTimeout.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runSyncChildTimeout } from "./syncChildTimeout.js";

await runGateEntry({ run: runSyncChildTimeout });
