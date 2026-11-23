/**
 * The own-hand-residue gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `ownHandResidue.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runOwnHandResidue } from "./ownHandResidue.js";

await runGateEntry({ run: runOwnHandResidue });
