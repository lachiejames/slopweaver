/**
 * The typescript-import-seam gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `typescriptImportSeam.ts`; this file existing IS the invocation, so there
 * is no `import.meta.url` guard to drift.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTypescriptImportSeam } from "./typescriptImportSeam.js";

await runGateEntry({ run: runTypescriptImportSeam });
