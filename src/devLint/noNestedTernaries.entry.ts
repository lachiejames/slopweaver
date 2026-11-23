/**
 * The no-nested-ternaries gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `noNestedTernaries.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNoNestedTernaries } from "./noNestedTernaries.js";

await runGateEntry({ run: runNoNestedTernaries });
