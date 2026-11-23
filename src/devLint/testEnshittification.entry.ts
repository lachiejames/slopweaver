/**
 * The test-enshittification gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The comparison logic + its exports live in `testEnshittification.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTestEnshittification } from "./testEnshittification.js";

await runGateEntry({ run: runTestEnshittification });
