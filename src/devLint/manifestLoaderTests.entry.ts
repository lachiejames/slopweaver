/**
 * The manifest-loader-tests gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `manifestLoaderTests.ts`; this file existing IS the invocation,
 * so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runManifestLoaderTests, unresolvedVerbs } from "./manifestLoaderTests.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

await runGateEntry({
  run: async () => {
    const textual = runManifestLoaderTests();
    const unresolved = await unresolvedVerbs();
    for (const address of unresolved) {
      process.stderr.write(`  ${address}  (manifest names an export that does not resolve to a function)\n`);
    }
    if (unresolved.length > 0) {
      process.stderr.write(
        `${lintGateRefusal({
          declaration: lintDeclarationFor({ id: "manifest-loader-tests-unresolved" }),
          detail: `${String(unresolved.length)} advertised verb(s) whose handler does not resolve`,
        })}\n`,
      );
    }
    return textual === 0 && unresolved.length === 0 ? 0 : 1;
  },
});
