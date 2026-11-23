/**
 * The outbound-form-strict gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `outboundFormStrict.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runOutboundFormStrict } from "./outboundFormStrict.js";

await runGateEntry({ run: runOutboundFormStrict });
