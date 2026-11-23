/**
 * The secrets-registry gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * check logic + its exports live in `secretsRegistry.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runSecretsRegistry } from "./secretsRegistry.js";

await runGateEntry({ run: runSecretsRegistry });
