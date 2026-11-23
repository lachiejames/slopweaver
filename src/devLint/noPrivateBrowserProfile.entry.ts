/**
 * The no-private-browser-profile gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `noPrivateBrowserProfile.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runPrivateBrowserProfile } from "./noPrivateBrowserProfile.js";

await runGateEntry({ run: runPrivateBrowserProfile });
