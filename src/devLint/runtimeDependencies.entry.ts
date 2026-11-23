/**
 * The runtime-dependencies gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * gate's logic and exports live in `runtimeDependencies.ts`; this file existing IS the invocation.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRuntimeDependencies } from "./runtimeDependencies.js";

await runGateEntry({ run: runRuntimeDependencies });
