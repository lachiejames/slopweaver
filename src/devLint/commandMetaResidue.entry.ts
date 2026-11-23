/**
 * The command-meta-residue gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `commandMetaResidue.ts`; this file existing IS the invocation,
 * so there is no `isDirectInvocation` guard.
 */
import { runCommandMetaResidue } from "./commandMetaResidue.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCommandMetaResidue });
