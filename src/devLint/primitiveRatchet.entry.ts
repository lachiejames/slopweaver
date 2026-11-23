/**
 * The primitive-ratchet gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `primitiveRatchet.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runPrimitiveRatchet } from "./primitiveRatchet.js";

await runGateEntry({ run: runPrimitiveRatchet });
