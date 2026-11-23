/**
 * The stdout-data-channel gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `stdoutDataChannel.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runStdoutDataChannel } from "./stdoutDataChannel.js";

await runGateEntry({ run: runStdoutDataChannel });
