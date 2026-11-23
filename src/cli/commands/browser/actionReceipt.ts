/**
 * What `browser act` prints once an interaction has run: where it landed, the posture it was admitted under, its
 * pictures, and anything the page did that the caller would otherwise not see — a dialog held open, a download, a
 * full-screen request the background guard refused.
 *
 * Pure. Split from `./actionCore.ts`, which keeps the flag parsing and the aim renderer.
 */
import type { BrowserActionReceipt } from "../../../browser/actionExecutor.js";
import { aimShotLines } from "../../../browser/aimShot.js";
import { fullscreenReceiptLines } from "../../../browser/fullscreenGuard.js";
import { renderAdmissionPosture } from "./actionCore.js";

/**
 * Render what one interaction did.
 *
 * @param receipt what the action produced
 * @param focusSkipped the line explaining a `--focus` that was asked for and not taken, or `null`
 * @param sessionId the session, so the fresh-look command prints ready to run
 * @returns the lines to print
 */
export function renderReceipt({
  receipt,
  focusSkipped,
  sessionId,
}: {
  receipt: BrowserActionReceipt;
  focusSkipped: string | null;
  sessionId: string;
}): readonly string[] {
  const lines = [`browser act: ${receipt.kind} done — ${receipt.afterUrl}`];
  if (receipt.afterUrl !== receipt.beforeUrl) {
    lines.push(`  the page moved: ${receipt.beforeUrl} -> ${receipt.afterUrl}`);
  }
  if (receipt.afterTitle !== null && receipt.afterTitle !== "") {
    lines.push(`  title: ${receipt.afterTitle}`);
  }
  lines.push(renderAdmissionPosture({ admission: receipt.admission }));
  if (receipt.aimShot !== null) {
    lines.push(...aimShotLines({ result: receipt.aimShot }));
  }
  if (focusSkipped !== null) {
    lines.push(focusSkipped);
  }
  lines.push(`  after: ${receipt.screenshotPath} — the viewport once it had run`);
  // The after-snapshot is not a look the next act can cite, and read whole it is the page dump the owner named
  // (`src/browser/snapshotOutline.ts`). So the line names the FRESH look that prints an outline —
  // a new snapshot of the page as it then stands, never this file's outline. A small page's snapshot comes back
  // inline with no file, and the fresh look is owed all the same.
  const freshLook = `\`slopweaver browser read --session ${sessionId}\` takes a fresh, citable look with an outline`;
  if (receipt.snapshotPath === null) {
    lines.push(`  elements now: ${freshLook}`);
  } else {
    lines.push(`  elements now: ${receipt.snapshotPath} — never read it whole; ${freshLook}`);
  }
  if (receipt.modalState !== null) {
    lines.push(`  the page is holding a dialog open: ${receipt.modalState}`);
  }
  lines.push(...fullscreenReceiptLines({ observation: receipt.fullscreenGuard }));
  if (receipt.download !== null) {
    lines.push(
      `  downloaded ${receipt.download.name} (${String(receipt.download.bytes)} bytes), attributed by ${receipt.download.provenance} — not a browser confirmation`,
    );
  }
  if (receipt.downloadPath !== null) {
    lines.push(`  copied to ${receipt.downloadPath}; your browser's own copy is left where it put it`);
  }
  if (receipt.admission.waivedBecause !== null) {
    lines.push(`  a page waiver allowed this: ${receipt.admission.waivedBecause}`);
  }
  return lines;
}
