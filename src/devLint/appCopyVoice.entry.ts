/**
 * The app-copy-voice gate entry point, nothing but the top-level invocation (run by `dev lint`). The scanner logic and
 * its exports live in `appCopyVoice.ts`; this file existing IS the invocation, so there is no `isDirectInvocation`
 * guard.
 */
import { runAppCopyVoice } from "./appCopyVoice.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAppCopyVoice });
