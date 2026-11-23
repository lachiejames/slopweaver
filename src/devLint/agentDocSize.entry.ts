/**
 * The agent-doc-size gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `agentDocSize.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runAgentDocSize } from "./agentDocSize.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAgentDocSize });
