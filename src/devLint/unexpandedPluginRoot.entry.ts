/**
 * The unexpanded-plugin-root gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `unexpandedPluginRoot.ts`; this file existing IS the invocation,
 * so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runUnexpandedPluginRoot } from "./unexpandedPluginRoot.js";

await runGateEntry({ run: runUnexpandedPluginRoot });
