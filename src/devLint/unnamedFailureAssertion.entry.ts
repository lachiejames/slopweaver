/**
 * The unnamed-failure-assertion gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic, the debt list and their exports live in `unnamedFailureAssertion.ts`; this file existing
 * IS the invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runUnnamedFailureAssertion } from "./unnamedFailureAssertion.js";

await runGateEntry({ run: runUnnamedFailureAssertion });
