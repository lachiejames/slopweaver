/**
 * The derived-card-voice gate's entry point — nothing but the top-level invocation (run by `dev lint`). The
 * judgement and its exports live in `derivedCardVoice.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { slopweaverHome } from "../config.js";
import { runDerivedCardVoice } from "./derivedCardVoice.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({
  run: () =>
    runDerivedCardVoice({
      home: slopweaverHome(),
      writeError: (text) => {
        process.stderr.write(text);
      },
      writeOut: (text) => {
        process.stdout.write(text);
      },
    }),
});
