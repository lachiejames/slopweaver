/**
 * Whether a Claude fallback may be prepared at all — the one read both `codex plan-fallback prepare` and
 * `codex review-fallback prepare` take before they capture anything.
 *
 * It lives beside the two verbs rather than inside either, because each used to carry its own copy of the
 * hatch's name, the registry id and the label its lines are prefixed with — three correlated strings, passed
 * positionally as three fields of one call, where swapping the plan row's id onto the review verb would have
 * printed a refusal naming the wrong hatch and still compiled. Here they are ONE table keyed by the verb, so
 * a caller names `verb: "plan"` and cannot express the mismatch.
 *
 * What it asks is the FLEET, never the ambient `$CODEX_HOME` (`../../../codex/fleetCap.ts`): a fallback is
 * legitimate only when nothing registered can take the pass, so a second open account is a routing decision
 * rather than a cap. The verdict is `../../../codex/fleetCap.ts`'s, and the pure mapping from it to a
 * decision lives in `../../../codex/fallbackCap.ts`.
 */

import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { decideFallbackCap } from "../../../codex/fallbackCap.js";
import { currentCodexFleetCap } from "../../../codex/fleetCap.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import type { FallbackFleetGround } from "../../../codex/providerUnregistered.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Each fallback verb's own hatch, registry row and label, held together so they cannot be mismatched.
 *
 * An override of one never opens the other: that is the reason there are two rows here rather than one
 * shared variable, and it is what the per-verb key preserves.
 */
const FALLBACK_HATCHES = {
  plan: {
    env: "SLOPWEAVER_ALLOW_FALLBACK_PLAN_UNCAPPED",
    id: "fallback-plan-uncapped",
    label: "codex plan-fallback prepare",
  },
  review: {
    env: "SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED",
    id: "fallback-review-uncapped",
    label: "codex review-fallback prepare",
  },
} as const satisfies Record<string, { env: string; id: Parameters<typeof hatchFor>[0]["id"]; label: string }>;

/**
 * The ground FIRST, before anything is captured: a fallback prepared while Codex is open is not a fallback —
 * unless no Codex plan is registered at all, when Claude is the configured provider.
 *
 * The fleet is read through `currentCodexFleetCap`, the same call `codex review` routes on
 * (`./passDeps.ts`), so the two can never disagree about one fleet: when the pass has nowhere to go and a
 * cap was read, this is the path that takes it. Its advisories print first, whatever the verdict — a login
 * they have not run is what turns a capped fleet back into a routed pass.
 *
 * @param home the state home whose register names every destination that would have to be capped
 * @param verb which fallback is asking, selecting its own hatch row out of {@link FALLBACK_HATCHES}
 * @returns the ground to record — a capacity reading, or no Codex plan registered — or the exit code to stop on
 */
export async function readFallbackGround({
  home,
  verb,
}: {
  home: string;
  verb: keyof typeof FALLBACK_HATCHES;
}): Promise<FallbackFleetGround | number> {
  return readFallbackGroundOver({
    fleetCap: codexFleetCapPort(),
    home,
    port: planRegisterPort(),
    signInPort: codexSignInPort(),
    verb,
  });
}

/**
 * {@link readFallbackGround} over an injected register port — the seam a test reads the fleet through
 * without a store. An unreadable register is no cap evidence (`currentCodexFleetCap`), so a store outage
 * refuses the fallback exactly as an open fleet does, unless the hatch is open.
 *
 * @param home the state home whose register names every destination that would have to be capped
 * @param port where the plan register is read
 * @param fleetCap where the fleet read files its conclusion
 * @param signInPort where the fleet read files each store's sign-in observation
 * @param verb which fallback is asking, selecting its own hatch row out of {@link FALLBACK_HATCHES}
 * @returns the ground to record — a capacity reading, or no Codex plan registered — or the exit code to stop on
 */
export async function readFallbackGroundOver({
  fleetCap,
  home,
  port,
  signInPort,
  verb,
}: {
  fleetCap: CodexFleetCapPort;
  home: string;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
  verb: keyof typeof FALLBACK_HATCHES;
}): Promise<FallbackFleetGround | number> {
  const hatch = FALLBACK_HATCHES[verb];
  // The hatch is read into a local and passed as a value, never a parameter default (`hatch-release`).
  const hatchOpen = process.env[hatch.env] === "1";
  const nowIso = new Date().toISOString();
  const fleet = await currentCodexFleetCap({
    fleetCap,
    home,
    nowIso,
    port,
    readLive: readCodexAccountsLive,
    signInPort,
  });
  for (const advisory of fleet.advisories) {
    logger.error({ msg: `${hatch.label}: ADVISORY: ${advisory}` });
  }
  const decision = decideFallbackCap({ fleet, hatchEnv: hatch.env, hatchOpen, nowIso });
  if (decision.kind === "refused") {
    logger.error({ msg: hatchRefusal({ detail: decision.detail, hatch: hatchFor({ id: hatch.id }) }) });
    return EXIT_ERROR;
  }
  if (decision.kind === "unregistered") {
    return { evidence: decision.evidence, kind: "unregistered" };
  }
  if (decision.kind === "overridden") {
    logger.error({ msg: `${hatch.label}: OVERRIDDEN by ${hatch.env}=1 — the request will say so` });
  }
  return { evidence: decision.evidence, kind: "cap" };
}
