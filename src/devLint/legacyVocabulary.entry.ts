/**
 * The legacy-vocabulary gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `legacyVocabulary.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runLegacyVocabulary } from "./legacyVocabulary.js";

await runGateEntry({ run: runLegacyVocabulary });
