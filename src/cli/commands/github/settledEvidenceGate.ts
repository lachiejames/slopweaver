/**
 * The settled-evidence gate on `github pr update`: a description write refuses to lose a screenshot or a run
 * link that a settled ask of the owner's named the pull request for. `./settledEvidenceCore.ts` holds the criterion and
 * the incident that measured it; this file reads the board and renders the outcome.
 *
 * It runs on every update mode — `--edit`, `--form` and `--file` — because all three send the bytes judged here,
 * and `SLOPWEAVER_ALLOW_PR_REPLACE=1` does NOT release it: that variable consents to replacing a body wholesale,
 * and it is exactly what a description rollout sets when it drops screenshots. The one way past is the
 * journalled `pr-evidence-loss` grant, which names the session, carries a reason and expires.
 *
 * The board is read only once the bodies show a loss, so an ordinary update pays nothing for it. A board that
 * cannot be read, or carries a row that will not parse, is a FACT refusal rather than a pass: whether the loss is
 * the owner's to protect cannot be established, and a gate that answered "no row" from an unread file would be the
 * silent fallback this repository refuses.
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { grantEnvOf } from "../../../hatch/grantSession.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { stateHomePaths } from "../../../stateHome.js";
import { lostProtectedEvidence, type PullRequestCoordinates, settledEvidenceLoss } from "./settledEvidenceCore.js";

/** What the gate decided about one write. */
export type SettledEvidenceDecision =
  | { readonly kind: "clear" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "overridden"; readonly notice: string }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The detail a refusal and an override notice both carry: which rows, which URLs. */
function lossDetail({ rowSlugs, lostUrls }: { rowSlugs: readonly string[]; lostUrls: readonly string[] }): string {
  return `settled owner rows: ${rowSlugs.join(", ")}; lost: ${lostUrls.join(", ")}`;
}

/**
 * The decision over rows already read — pure, so it is tested without a board on disk.
 *
 * @param docs every board row, live and archived
 * @param hatchIsOpen whether this session holds a live `pr-evidence-loss` grant
 * @param liveBody the description as it stands
 * @param newBody the exact bytes the write would send
 * @param pull the pull request the write targets
 * @returns clear, refused with the four-line hatch refusal, or overridden with a notice naming what it waived
 */
export function settledEvidenceDecision({
  docs,
  hatchIsOpen,
  liveBody,
  newBody,
  pull,
}: {
  docs: readonly HandoverDoc[];
  hatchIsOpen: boolean;
  liveBody: string | undefined;
  newBody: string;
  pull: PullRequestCoordinates;
}): SettledEvidenceDecision {
  const loss = settledEvidenceLoss({ docs, liveBody, newBody, pull });
  if (loss === undefined) {
    return { kind: "clear" };
  }
  const detail = lossDetail(loss);
  if (hatchIsOpen) {
    return {
      kind: "overridden",
      notice: `OVERRIDDEN via the journalled pr-evidence-loss grant — dropping evidence a settled ask named (${detail}). Say so in the pull request.`,
    };
  }
  return { kind: "refused", refusal: hatchRefusal({ detail, hatch: hatchFor({ id: "pr-evidence-loss" }) }) };
}

/** Every row on the live board and in its archive, or why they could not all be read. */
function boardRows({
  home,
}: {
  home: string;
}):
  { readonly kind: "read"; readonly docs: readonly HandoverDoc[] } | { readonly kind: "unread"; readonly why: string } {
  const paths = stateHomePaths({ home });
  const docs: HandoverDoc[] = [];
  for (const handoverDir of [paths.handovers, paths.handoverArchive]) {
    const scanned = scanBoard({ handoverDir });
    if (scanned.isErr()) {
      return { kind: "unread", why: `the board at ${handoverDir} could not be read: ${scanned.error.message}` };
    }
    if (scanned.value.unreadable.length > 0) {
      const names = scanned.value.unreadable.join(", ");
      return { kind: "unread", why: `${handoverDir} holds rows that will not parse (${names})` };
    }
    docs.push(...scanned.value.docs);
  }
  return { docs, kind: "read" };
}

/**
 * Judge one description write against every settled ask of the owner's on the board.
 *
 * @param home the state home whose board and grant journal are read
 * @param env how the session's grant identity is read
 * @param nowIso the instant a grant's expiry is judged against
 * @param liveBody the description as it stands
 * @param newBody the exact bytes the write would send
 * @param pull the pull request the write targets
 * @returns the decision; `unreadable` when a loss exists and the board could not be read to say whose it is
 */
export function judgeSettledEvidence({
  home,
  env,
  nowIso,
  liveBody,
  newBody,
  pull,
}: {
  home: string;
  env: (args: { name: string }) => string | undefined;
  nowIso: string;
  liveBody: string | undefined;
  newBody: string;
  pull: PullRequestCoordinates;
}): SettledEvidenceDecision {
  if (lostProtectedEvidence({ liveBody, newBody, pull }).length === 0) {
    return { kind: "clear" };
  }
  const board = boardRows({ home });
  if (board.kind === "unread") {
    return {
      kind: "unreadable",
      reason: `this write drops a screenshot or run link and ${board.why}, so whether a settled ask of the owner's protects it cannot be established. Fix the row and re-run`,
    };
  }
  const hatchIsOpen = hatchOpen({ env: grantEnvOf({ read: env }), home, id: "pr-evidence-loss", nowIso });
  return settledEvidenceDecision({ docs: board.docs, hatchIsOpen, liveBody, newBody, pull });
}
