/**
 * Entry point for the scheduler-bypass gate. Kept separate from the scanner so the module stays importable
 * by a test without running the walk (the repo's entry-point convention — no `isDirectInvocation` guard).
 */
import { runGateEntry } from "./gateEntry.js";
import { runSchedulerBypass } from "./schedulerBypass.js";

await runGateEntry({ run: runSchedulerBypass });
