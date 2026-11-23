/**
 * The no-proof-path gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * and its exports live in `noProofPath.ts`; this file existing IS the invocation.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNoProofPath } from "./noProofPath.js";

await runGateEntry({ run: runNoProofPath });
