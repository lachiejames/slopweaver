/**
 * The doc-links gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `docLinks.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runDocLinks } from "./docLinks.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runDocLinks });
