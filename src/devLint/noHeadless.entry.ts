/**
 * Entry point for the no-headless gate. Kept separate from the scanner so the module stays importable by a
 * test without running the walk (the repo's entry-point convention — no `isDirectInvocation` guard).
 */
import { runGateEntry } from "./gateEntry.js";
import { runNoHeadless } from "./noHeadless.js";

await runGateEntry({ run: runNoHeadless });
