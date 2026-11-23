/**
 * The write-and-render tail of `slopweaver turn brief`: build the brief from an already-admitted target and
 * routing input, record the captured ask's lifecycle, write the brief file, and print the rendered brief.
 * Every refusal is decided before this runs, in `./brief.ts`'s `compose`.
 */
import { parsePainPoints, readPainPointsText } from "../../../admit/painPoint.js";
import { logger } from "../../../lib/logger.js";
import { installedTreeRoot } from "../../../lib/pluginRoot.js";
import { ensureCapturedAskLifecycle } from "../../../live/ask/store.js";
import { buildTurnRoutingBrief, renderTurnRoutingBrief } from "../../../live/turn/brief.js";
import { writeBrief } from "../../../live/turn/briefStore.js";
import type { routingInputForTurn } from "../../../live/turn/routingContext.js";
import { availableSkills } from "../../../live/turn/skillCatalogue.js";
import { tagDecisionTreeFor } from "../../../live/turn/tagDecisionTreeStore.js";
import { censusLinesFor } from "../../../route/censusReadings.js";
import type { SkippedCapability, SourceCapability } from "../../../route/profile.js";
import { EXIT_OK } from "../../exitCodes.js";
import { otherActiveAsksFor, witnessAskContextFor } from "./briefAskContext.js";
import type { BriefTarget } from "./briefTarget.js";

/**
 * Build the brief, write it under `home`, and render it — the tail `compose` shares between its early-refusal
 * checks and the actual write, extracted so `compose` itself stays under the function-length gate.
 *
 * @param home the resolved state home
 * @param path where to write the brief
 * @param routingInput the routing-judgement input this brief carries
 * @param startedRef the started ref to embed, when one was resolved
 * @param target the brief's target
 * @param unavailableCapabilities capabilities current-truth but unreachable from here
 * @param skippedCapabilities overlay rows declared and unusable, carried into the written brief
 * @returns `EXIT_OK`
 */
export function writeAndRenderBrief({
  home,
  path,
  ridesOn,
  routingInput,
  skippedCapabilities,
  startedRef,
  target,
  unavailableCapabilities,
}: {
  home: string;
  path: string;
  ridesOn: string | undefined;
  routingInput: ReturnType<typeof routingInputForTurn>;
  skippedCapabilities: readonly SkippedCapability[];
  startedRef: { readonly turnId: string; readonly workingTs: string } | undefined;
  target: BriefTarget;
  unavailableCapabilities: readonly SourceCapability[];
}): number {
  const brief = buildTurnRoutingBrief({
    channel: target.channel,
    messageTs: target.messageTs,
    otherActiveAsks: otherActiveAsksFor({ home, target }),
    question: target.text,
    routingInput,
    skippedCapabilities,
    surface: target.surface,
    threadTs: target.threadTs,
    unavailableCapabilities,
    userId: target.userId,
    ...witnessAskContextFor({ home, target }),
    ...(startedRef === undefined ? {} : { started: startedRef }),
    ...(ridesOn === undefined ? {} : { ridesOn }),
  });
  ensureCapturedAskLifecycle({
    askIdentity: target,
    home,
    surface: target.surface,
    text: target.text,
    userId: target.userId,
  });
  writeBrief({ brief, path });
  const painPoints = parsePainPoints({ text: readPainPointsText({ home }) });
  const skills = availableSkills({ home, repoRoot: installedTreeRoot({ importMetaUrl: import.meta.url }) });
  const censusLines = censusLinesFor({ home, question: target.text });
  const tagTree = tagDecisionTreeFor({ home, userId: target.userId });
  for (const line of renderTurnRoutingBrief({ brief, briefPath: path, censusLines, painPoints, skills, tagTree })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
