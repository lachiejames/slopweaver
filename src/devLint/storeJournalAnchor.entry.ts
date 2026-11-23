/**
 * The store-journal-anchor gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `storeJournalAnchor.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runStoreJournalAnchor } from "./storeJournalAnchor.js";

await runGateEntry({ run: runStoreJournalAnchor });
