/**
 * The child `accountHomeSandboxPreload.test.ts` spawns under `tsx`: prints what `accountDefaultHome()` answers in
 * a fresh process, one line, nothing else. Not a test file. It runs the real `src/homeDir.ts`, so what it prints is
 * what every Slopweaver verb in that child would resolve the owner's protect list against.
 */
import { accountDefaultHome } from "../../../homeDir.js";

process.stdout.write(`${accountDefaultHome()}\n`);
