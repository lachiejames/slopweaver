/**
 * The hygiene-gate entry point — nothing but the top-level invocation (run by `scripts/check-hygiene.sh`).
 * The scanner logic + its exports live in `scan.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard. Its listing runs past one pipe buffer, so it drains before exiting
 * (`../lib/drainStdio.ts`).
 */
import { drainStdio } from "../lib/drainStdio.js";
import { runScan } from "./repoScan.js";

const code = runScan();
await drainStdio();
process.exit(code);
