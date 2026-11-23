/**
 * Entry point for the operation-label gate. Kept separate from the scanner so the module stays importable
 * by a test without running the walk (the repo's entry-point convention — no `isDirectInvocation` guard).
 */
import { runGateEntry } from "./gateEntry.js";
import { runOperationLabels } from "./operationLabels.js";

await runGateEntry({ run: runOperationLabels });
