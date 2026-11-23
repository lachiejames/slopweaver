/**
 * The drizzle-migrations gate entry point — nothing but the top-level invocation (run by `dev lint`). The run lives
 * in `drizzleMigrationsRun.ts` and the six checks in `drizzleMigrations.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { checkDrizzleMigrations } from "./drizzleMigrationsRun.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: checkDrizzleMigrations });
