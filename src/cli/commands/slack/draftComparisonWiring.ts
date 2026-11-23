/**
 * The production wiring for the two edges a comparison adds to `slack draft` (`./draftCompareRun.ts`): one sealed
 * Codex pass routed — and, on a usage-limited account, reserved — exactly as `codex plan` routes one, and their voice
 * brief off the profile.
 *
 * Split from `./draftWiring.ts` so the Codex client stays a leaf that file spreads, rather than a dozen imports
 * threaded through a bag whose point is that it cannot post.
 */
import { makePassBound } from "../../../codex/bounds.js";
import { fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { systemDeadlineRuntime } from "../../../codex/runPass.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import { runSlackDraftPass, SLACK_DRAFT_PASS_SECONDS } from "../../../codex/slackDraftPass.js";
import { supersessionPort } from "../../../codex/supersessionStore.js";
import { loadVoiceRuleBrief } from "../../../outbound/voice/briefStore.js";
import { planRegisterPort } from "../../../plans/port.js";
import { productionCodexClientFor, productionCodexPassReservationPort, routedCodexPass } from "../codex/passDeps.js";
import type { DraftComparisonDeps } from "./draftCompareRun.js";

/**
 * The live comparison edges.
 *
 * @returns the sealed Codex pass and the voice-brief read
 */
export function liveDraftComparisonDeps(): DraftComparisonDeps {
  return {
    codexDraft: async ({ brief, home }) => {
      const bound = makePassBound({ boundSeconds: SLACK_DRAFT_PASS_SECONDS });
      if (bound.isErr()) {
        return { kind: "unavailable", reason: bound.error.message };
      }
      const runtime = systemDeadlineRuntime();
      const routed = await routedCodexPass({
        bound: bound.value,
        deps: {
          clientFor: productionCodexClientFor({ posture: "sealed" }),
          fallbackPort: fallbackRegisterPort(),
          reservationPort: productionCodexPassReservationPort({
            fleetCap: codexFleetCapPort(),
            port: planRegisterPort(),
            signInPort: codexSignInPort(),
          }),
          runtime,
          supersessions: supersessionPort(),
        },
        home,
        model: CODEX_MODEL,
      });
      if (typeof routed === "number") {
        return { kind: "unavailable", reason: "no Codex seat could take the pass (the line above names why)" };
      }
      try {
        return await runSlackDraftPass({ brief, client: routed.client, runtime });
      } finally {
        await routed.release();
      }
    },
    loadVoiceBrief: ({ home }) => loadVoiceRuleBrief({ home }),
  };
}
