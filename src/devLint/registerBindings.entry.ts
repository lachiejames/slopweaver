/**
 * The register-bindings gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * effectful shell + its runner live in `registerBindings.ts` and the pure rules in `registerBindingsCore.ts`;
 * this file existing IS the invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRegisterBindings } from "./registerBindings.js";

await runGateEntry({ run: runRegisterBindings });
