/**
 * The testing-discipline gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `testingDiscipline.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTestingDiscipline } from "./testingDiscipline.js";

await runGateEntry({ run: runTestingDiscipline });
