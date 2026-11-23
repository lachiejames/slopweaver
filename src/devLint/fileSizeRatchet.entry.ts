/**
 * The file-size-ratchet gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `fileSizeRatchet.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runFileSizeRatchet } from "./fileSizeRatchet.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runFileSizeRatchet });
