/**
 * `codex route` as a real process over an in-memory plan register, for `verbCodexRoute.test.ts`. Not a test file:
 * it is the process that test spawns under `tsx`, in the place the shipped binary would stand.
 *
 * The register and the sign-in observations live in the store and no lane has one, so this runs the shipped verb
 * body (`runCodexRouteOver`) over `memoryPlanRegisterPort()` and `memoryCodexSignInPort()` — the register's first
 * read imports the `plans.json` the test seeded into `$SLOPWEAVER_HOME` through the real legacy-file path. Everything below the register is the
 * production read: the deadline it inherits, the `tclsh` it launches and the app-servers that one starts.
 *
 * The fleet-cap record lives in the store too, so it is filed into `memoryCodexFleetCapPort()`. That store dies with
 * this process, so whatever it holds at exit is written to the path {@link FILED_FLEET_CAP_ENV} names — the one
 * thing the parent can read back to see whether a deadline-bound read filed a record.
 *
 * Invoked as `tsx codexRouteChild.entry.ts codex route [flags...]`, so its argv carries the same four leading
 * entries `bin/slopweaver codex route` does.
 */
import { writeFileSync } from "node:fs";

import { runCodexRouteOver } from "../../../../../cli/commands/codex/routeRun.js";
import { memoryCodexFleetCapPort, memoryCodexFleetCapStore } from "../../../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../../../codexSignInFixture.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";

/** The variable naming the file this child writes the fleet-cap rows it filed into, only when it filed one. */
const FILED_FLEET_CAP_ENV = "ROUTE_CHILD_FILED_FLEET_CAP";

const fleetCapStore = memoryCodexFleetCapStore();
process.exitCode = await runCodexRouteOver({
  argv: process.argv,
  fleetCap: memoryCodexFleetCapPort({ store: fleetCapStore }),
  port: memoryPlanRegisterPort(),
  signInPort: memoryCodexSignInPort(),
});
if (fleetCapStore.rows.size > 0) {
  writeFileSync(process.env[FILED_FLEET_CAP_ENV]!, JSON.stringify([...fleetCapStore.rows.values()]));
}
