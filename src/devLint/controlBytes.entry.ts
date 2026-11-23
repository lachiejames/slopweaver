/**
 * The control-byte gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `controlBytes.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runControlBytes } from "./controlBytes.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runControlBytes });
