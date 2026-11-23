/**
 * The atlas-content-coverage gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic and its exports live in `atlasContentCoverage.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runAtlasContentCoverage } from "./atlasContentCoverage.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAtlasContentCoverage });
