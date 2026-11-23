/**
 * The retired-claude-transport gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `retiredClaudeTransport.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRetiredClaudeTransport } from "./retiredClaudeTransport.js";

await runGateEntry({ run: runRetiredClaudeTransport });
