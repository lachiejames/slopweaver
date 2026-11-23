/**
 * The what-and-why section of a reading-order body, rendered: the origin line, Problem and Change, the optional
 * Before-and-after table, fails-on-main witness and click-through line, Other claims, and the optional visible
 * Proof section. Pure.
 *
 * Split out of `./render.ts` because it is the largest section, the exact inverse of `./parseWhat.ts`. Every
 * block carries the key a pasted block is re-placed by (`./pastedMedia.ts`).
 */
import { longDay } from "../days.js";
import { escapeCell, imageTag } from "../htmlText.js";
import type { KeyedBlock } from "./pastedMedia.js";
import { LAYOUT, renderContent, renderEvidence } from "./renderLayout.js";
import type { BeforeAfter, Claim, ClickThrough, FailsOnMain, ProblemSeen, ProofItem, StampedPrBody } from "./types.js";

/** The Before-and-after table; the problem's Where cell carries the day it was seen. */
function beforeAfterTable({ beforeAfter, seen }: { beforeAfter: BeforeAfter; seen: ProblemSeen }): string {
  const seenSuffix = seen.kind === "seen" ? `, seen ${longDay({ day: seen.on })}` : "";
  const { problem, fix } = beforeAfter;
  return [
    "<table>",
    LAYOUT.beforeAfterHeader,
    `<tr><td><strong>Where</strong></td><td>${renderContent({ content: problem.where })}${seenSuffix}</td>` +
      `<td>${renderContent({ content: fix.where })}</td></tr>`,
    `<tr><td><strong>Evidence</strong></td><td>${renderEvidence({ evidence: problem.evidence })}</td>` +
      `<td>${renderEvidence({ evidence: fix.evidence })}</td></tr>`,
    "</table>",
  ].join("\n");
}

/** The one-line fails-on-main witness. */
function failsOnMainLine({ failsOnMain }: { failsOnMain: FailsOnMain }): string {
  return (
    `${LAYOUT.failsOnMainOpen}<code>${escapeCell({ text: failsOnMain.command })}</code>: ❌ on main at ` +
    `<code>${failsOnMain.mainSha}</code>, ✅ on this branch.</p>`
  );
}

/**
 * The one-line click-through witness. `<br>` separates the control from what it opened: every run escapes `<`,
 * so the only `<br>` on the line is this one, and `./parseWhat.ts` splits on it.
 */
function clickThroughLine({ clickThrough }: { clickThrough: ClickThrough }): string {
  const { commit, control, destination } = clickThrough;
  return (
    `${LAYOUT.clickThroughOpen}${commit}</code>:</strong> ${renderContent({ content: control })}<br>` +
    `${renderEvidence({ evidence: destination })}</p>`
  );
}

/** One claim's proof cell. */
function claimProofCell({ claim }: { claim: Claim }): string {
  const { proof } = claim;
  if (proof.kind === "proven") {
    return `✅ ${renderEvidence({ evidence: proof.evidence })}`;
  }
  if (proof.kind === "gap") {
    return `⚠️ not checked: ${renderContent({ content: proof.why })}`;
  }
  return `❌ ${renderContent({ content: proof.why })}`;
}

/** The Other claims table, or the fixed sentence that stands in for an empty one. */
function claimsBlock({ claims }: { claims: readonly Claim[] }): string {
  if (claims.length === 0) {
    return LAYOUT.claimsEmpty;
  }
  const rows = claims.map(
    (claim) => `<tr><td>${renderContent({ content: claim.claim })}</td><td>${claimProofCell({ claim })}</td></tr>`,
  );
  return ["<table>", LAYOUT.claimsHeader, ...rows, "</table>"].join("\n");
}

/**
 * One Proof item's line: the caption, then its picture. `<br>` separates them, and every run escapes `<`, so the
 * only `<br>` on the line is this one, and `./parseWhat.ts` splits on it.
 */
function proofItemLine({ item }: { item: ProofItem }): string {
  return `<p>${renderContent({ content: item.caption })}<br>${imageTag(item.image)}</p>`;
}

/** The optional witness blocks between Change and Other claims: Before and after, fails on main, click-through. */
function witnessBlocks({ body }: { body: StampedPrBody }): readonly KeyedBlock[] {
  const blocks: KeyedBlock[] = [];
  if (body.beforeAfter !== undefined) {
    blocks.push(
      { key: "before-after-heading", text: LAYOUT.beforeAfterHeading },
      { key: "before-after", text: beforeAfterTable({ beforeAfter: body.beforeAfter, seen: body.problemSeen }) },
    );
  }
  if (body.failsOnMain !== undefined) {
    blocks.push({ key: "fails-on-main", text: failsOnMainLine({ failsOnMain: body.failsOnMain }) });
  }
  if (body.clickThrough !== undefined) {
    blocks.push({ key: "click-through", text: clickThroughLine({ clickThrough: body.clickThrough }) });
  }
  return blocks;
}

/** The visible Proof section — one captioned picture per line — or nothing when the body carries none. */
function proofBlocks({ proof }: { proof: readonly ProofItem[] | undefined }): readonly KeyedBlock[] {
  if (proof === undefined) {
    return [];
  }
  return [
    { key: "proof-heading", text: LAYOUT.proofHeading },
    { key: "proof", text: proof.map((item) => proofItemLine({ item })).join("\n") },
  ];
}

/**
 * The what-and-why section's blocks, in render order.
 *
 * @param body the stamped body
 * @returns the section's keyed blocks, the optional ones present only when the body carries them
 */
export function whatBlocks({ body }: { body: StampedPrBody }): readonly KeyedBlock[] {
  return [
    { key: "what-heading", text: LAYOUT.whatHeading },
    { key: "origin", text: `<p><em>${renderContent({ content: body.origin })}</em></p>` },
    { key: "problem-heading", text: LAYOUT.problemHeading },
    { key: "problem", text: `<p>${renderContent({ content: body.problem })}</p>` },
    { key: "change-heading", text: LAYOUT.changeHeading },
    { key: "change", text: `<p>${renderContent({ content: body.change })}</p>` },
    ...witnessBlocks({ body }),
    { key: "claims-heading", text: LAYOUT.claimsHeading },
    { key: "claims", text: claimsBlock({ claims: body.claims }) },
    ...proofBlocks({ proof: body.proof }),
  ];
}
