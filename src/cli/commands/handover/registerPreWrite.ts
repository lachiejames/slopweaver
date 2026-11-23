/**
 * Every reason `slopweaver handover register` refuses a row BEFORE it writes one.
 *
 * Its own module beside `./staleEvidenceGate.ts` rather than inside `./askRowRun.ts`, along the seam that
 * file's header already names: `askRowRun.ts` holds what `register` DOES with a parse, and it sits at the
 * file-size ratchet, so the second pre-write refusal is what turns "one more `if`" into a real split. Both
 * refusals below are printed by the gate that owns them; nothing here words one.
 */
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { AskShape } from "../../../handover/askShape.js";
import { unrootedBriefPathRefusal } from "../../../handover/briefPathGate.js";
import { logger } from "../../../lib/logger.js";
import { anchorAttributionRefused } from "./anchorAttributionGate.js";
import {
  cardSignInExit,
  exampleTexts,
  namedDraftExit,
  shapeTexts,
  undrawnAskDraftExit,
} from "./namedDraftAdmission.js";
import { staleEvidenceGateRefused } from "./staleEvidenceGate.js";

/**
 * Refuse an ask whose own text names a path relative to the state home.
 *
 * Nothing in such a text says where the path starts, so the seat that picks the row up goes and looks for
 * it — a scan of the disk rather than an open of a file (`../../../handover/briefPaths.ts`). The
 * repository the row declares is what exempts a repo-relative path; with no `repo:` the only honest root is
 * where the verb is being run.
 *
 * @param ask the ask exactly as it will be written into the row
 * @param home the state home the row is being written under
 * @param repo the repository the row declares, absent when it declares none
 * @returns true when the refusal was printed and the verb must stop
 */
function unrootedAskRefused({ ask, home, repo }: { ask: string; home: string; repo: string | undefined }): boolean {
  let repoRoot = process.cwd();
  if (repo !== undefined) {
    repoRoot = repo;
  }
  const refusal = unrootedBriefPathRefusal({
    command: "slopweaver handover register",
    env: process.env,
    home,
    repoRoot,
    text: ask,
  });
  if (refusal === undefined) {
    return false;
  }
  logger.error({ msg: `handover register: ${refusal}` });
  return true;
}

/**
 * Refuse a finding whose evidence names code the upstream has already rewritten.
 *
 * @param evidence the finding's evidence paths
 * @returns true when the refusal was printed and the verb must stop
 */
function staleFindingRefused({ evidence }: { evidence: readonly string[] }): boolean {
  return staleEvidenceGateRefused({
    env: process.env,
    evidence,
    out: ({ line }) => {
      logger.error({ msg: line });
    },
  });
}

/**
 * Refuse a row whose summary or example scene says someone other than its Slack anchor's poster asked.
 *
 * @param anchor the row's `--anchor`, absent when it has none
 * @param ask the ask exactly as it will be written into the row
 * @param examples the row's example scenes, absent when it carries none
 * @param home the state home whose corpus says who posted the anchor
 * @returns true when the refusal was printed and the verb must stop
 */
function misattributedAnchorRefused({
  anchor,
  ask,
  examples,
  home,
}: {
  anchor: string | undefined;
  ask: string;
  examples: AskExampleSet | undefined;
  home: string;
}): boolean {
  return anchorAttributionRefused({
    anchor,
    env: process.env,
    home,
    out: ({ line }) => {
      logger.error({ msg: line });
    },
    texts: [ask, ...exampleTexts({ examples })],
  });
}

/**
 * Every pre-write refusal, in the order they were added.
 *
 * A finding whose evidence names code the upstream has already rewritten is a diagnosis of a repository that
 * no longer exists, and registering it is what turns one seat's stale read into fleet work
 * (`./staleEvidenceGate.ts` carries the cascade). A row whose text names an unrootable path costs the
 * seat that picks it up a scan of the disk. A row saying someone other than its Slack anchor's poster
 * asked puts a link to a stranger's message under the owner's card (`./anchorAttributionGate.ts`).
 *
 * @param plan the resolved register plan, past its refusal arm
 * @returns true when a refusal was printed and the verb must stop
 */
export async function registerPreWriteRefused({
  plan,
}: {
  plan: {
    readonly ask: string;
    readonly home: string;
    readonly repo: string | undefined;
    readonly slug: string;
    readonly finding: { readonly evidence: readonly string[] } | undefined;
    readonly dispatch: boolean;
    readonly shape: AskShape | undefined;
    readonly anchor: string | undefined;
    readonly examples: AskExampleSet | undefined;
  };
}): Promise<boolean> {
  if (plan.finding !== undefined && staleFindingRefused({ evidence: plan.finding.evidence })) {
    return true;
  }
  if (unrootedAskRefused({ ask: plan.ask, home: plan.home, repo: plan.repo })) {
    return true;
  }
  // Every Slack-anchored row draws a card whose link opens the anchor, a finding or a dispatch row included.
  if (misattributedAnchorRefused({ anchor: plan.anchor, ask: plan.ask, examples: plan.examples, home: plan.home })) {
    return true;
  }
  // A DECISION row is a card the owner reads; a finding or a dispatch row asks them to send nothing, so a draft its
  // evidence cites is history rather than a card asking them to react to it.
  if (plan.finding !== undefined || plan.dispatch) {
    return false;
  }
  return decisionCardRefused({ plan });
}

/** The prose gates on the card a decision row draws: a held draft, an undrawn one, a sign-in. */
async function decisionCardRefused({
  plan,
}: {
  plan: {
    readonly ask: string;
    readonly home: string;
    readonly slug: string;
    readonly shape: AskShape | undefined;
    readonly examples: AskExampleSet | undefined;
  };
}): Promise<boolean> {
  const drafts = namedDraftExit({
    command: "slopweaver handover register",
    env: process.env,
    home: plan.home,
    texts: [plan.slug, plan.ask, ...shapeTexts({ shape: plan.shape })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (drafts !== undefined) {
    return true;
  }
  const card = [plan.ask, ...shapeTexts({ shape: plan.shape })];
  // A decision row carries no --action at register time, so only a named draft carries a message it speaks of.
  const undrawn = undrawnAskDraftExit({
    command: "slopweaver handover register",
    env: process.env,
    named: [plan.slug],
    offersMessage: false,
    texts: card,
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (undrawn !== undefined) {
    return true;
  }
  const signIn = await cardSignInExit({
    command: "slopweaver handover register",
    fleetTexts: [...card, ...exampleTexts({ examples: plan.examples })],
    home: plan.home,
    planTexts: card,
  });
  return signIn !== undefined;
}
