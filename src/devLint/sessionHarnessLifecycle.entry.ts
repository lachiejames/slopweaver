/**
 * The session-harness-lifecycle gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner and its exports live in `sessionHarnessLifecycle.ts`; this file existing IS the invocation.
 */
import { runGateEntry } from "./gateEntry.js";
import { runSessionHarnessLifecycle } from "./sessionHarnessLifecycle.js";

await runGateEntry({ run: runSessionHarnessLifecycle });
