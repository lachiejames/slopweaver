/**
 * The atlas-manifest-clock gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `atlasManifestClock.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runAtlasManifestClock } from "./atlasManifestClock.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAtlasManifestClock });
