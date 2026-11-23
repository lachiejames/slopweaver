/**
 * The naming-doctrine gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * criterion lives in `namingDoctrine.ts`, the shell in `namingDoctrineRun.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNamingDoctrine } from "./namingDoctrineRun.js";

await runGateEntry({ run: runNamingDoctrine });
