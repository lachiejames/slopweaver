import { runCliCommandBoundary } from "./cliCommandBoundary.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCliCommandBoundary });
