/**
 * The coverage-ratchet gate entry point — nothing but the top-level invocation (run by `dev lint` with
 * `--summary-only`, and standalone as `yarn coverage:ratchet` / `--rebaseline`). The logic + its exports
 * live in `coverageRatchet.ts`; this file existing IS the invocation (no `isDirectInvocation` guard).
 *
 * This is the ONLY place the real `process` is supplied. Everything the gate needs — cwd, env, both output
 * streams — is a parameter, so the shell's ORDERING is reachable from a test. Three defects in this PR's
 * review lived in that ordering, every one of them "reported clean while checking nothing", and none was
 * catchable while the function read `process` directly.
 */
import { runCoverageRatchet } from "./coverageRatchet.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({
  run: () =>
    runCoverageRatchet({
      argv: process.argv,
      cwd: process.cwd(),
      env: process.env,
      writeErr: ({ text }) => {
        process.stderr.write(text);
      },
      writeOut: ({ text }) => {
        process.stdout.write(text);
      },
    }),
});
