/**
 * The claude-email-not-identity gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `claudeEmailIdentity.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runClaudeEmailIdentity } from "./claudeEmailIdentity.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runClaudeEmailIdentity });
