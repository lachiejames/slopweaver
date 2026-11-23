/**
 * The running-checkout-root gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `runningCheckoutRoot.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRunningCheckoutRoot } from "./runningCheckoutRoot.js";

await runGateEntry({ run: runRunningCheckoutRoot });
