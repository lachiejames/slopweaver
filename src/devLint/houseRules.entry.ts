/**
 * The house-rules gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `houseRules.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runHouseRules } from "./houseRules.js";

await runGateEntry({ run: runHouseRules });
