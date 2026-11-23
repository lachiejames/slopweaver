/**
 * The screenshots section of an atlas page, and the outcome type the shell hands it: what became of each
 * picture when the shell went to read it.
 *
 * Pure, like the rest of the renderer. `./pageScreenshots.ts` chooses which pictures an atlas holds, the shell
 * reads and verifies their bytes, and this module only prints what arrived.
 */
import { details } from "./pageMarkup.js";
import type { AtlasPageModel, AtlasPageScreenshot } from "./pageModel.js";
import { escapeHtml } from "./pageTable.js";

/**
 * What became of one screenshot when the shell went to read it.
 *
 * Five states rather than a picture-or-nothing, because a Codex pre-mortem caught the page
 * printing "held on disk" for a file that had been deleted. `budget-held` is the only one where the bytes
 * really are still there and simply did not fit; the other three failures are each a different defect a
 * reader has to be able to see.
 *
 * @internal
 */
type AtlasPageShotStatus = "embedded" | "budget-held" | "unreadable" | "integrity-failed" | "path-refused";

/**
 * One screenshot's outcome, with its bytes when they were read and verified.
 *
 * The renderer stays pure by taking these rather than reading them: a page that opened files could not be
 * unit-tested without a filesystem, and the honesty statement about what happened to each shot has to be
 * computed from what actually arrived rather than from what the manifest says is on disk.
 *
 * @internal
 */
export interface AtlasPageEmbeddedShot {
  readonly sha256: string;
  readonly status: AtlasPageShotStatus;
  readonly dataUri: string | null;
}

/** What one shot status means, in the words the page prints beside the picture that is not there. */
const SHOT_STATUS_WORDS: Readonly<Record<AtlasPageShotStatus, string>> = {
  "budget-held": "held on disk — it did not fit this page's screenshot budget",
  embedded: "embedded",
  "integrity-failed": "GONE OR CHANGED — the bytes on disk are not the ones this atlas recorded",
  "path-refused": "REFUSED — the stored path points outside this atlas's own directory",
  unreadable: "MISSING — the file this atlas recorded could not be read",
};

/**
 * The screenshots, each carrying what actually became of it.
 *
 * @returns the section's HTML
 */
export function screenshotsSection({
  model,
  embedded,
}: {
  model: AtlasPageModel;
  embedded: readonly AtlasPageEmbeddedShot[];
}): string {
  const byDigest = new Map(embedded.map((shot) => [shot.sha256, shot]));
  const figures = model.screenshots.map((shot) => figureFor({ outcome: byDigest.get(shot.sha256), shot }));
  const shown = embedded.filter((shot) => shot.status === "embedded").length;
  const broken = embedded.filter(
    (shot) => shot.status === "unreadable" || shot.status === "integrity-failed" || shot.status === "path-refused",
  ).length;
  const brokenNote =
    broken === 0
      ? ""
      : ` <strong>${String(broken)} of them could not be verified against the digest this atlas recorded.</strong>`;
  const statement = `<p class="muted">${String(shown)} of ${String(model.screenshots.length)} screenshot(s) embedded in this page.${brokenNote}</p>`;
  return details({
    body: `${statement}<div class="shots">${figures.join("")}</div>`,
    open: broken > 0,
    summary: `Screenshots held (${String(model.screenshots.length)}${broken === 0 ? "" : `, ${String(broken)} unverifiable`})`,
  });
}

/** One screenshot, as a picture when its bytes were read and verified and as its status when they were not. */
function figureFor({
  shot,
  outcome,
}: {
  shot: AtlasPageScreenshot;
  outcome: AtlasPageEmbeddedShot | undefined;
}): string {
  // A shot the shell never read did not fit this page's screenshot budget: its bytes are still on disk.
  if (outcome === undefined) {
    return picturelessFigure({ shot, status: "budget-held" });
  }
  if (outcome.dataUri === null) {
    return picturelessFigure({ shot, status: outcome.status });
  }
  const caption = shotCaption({ shot, status: outcome.status });
  return `<figure class="shot"><img src="${escapeHtml({ value: outcome.dataUri })}" alt="${escapeHtml({ value: shot.providerId })}" loading="lazy" />${caption}</figure>`;
}

/** One screenshot's caption: which page it shows, its size and digest, and what became of it. */
function shotCaption({ shot, status }: { shot: AtlasPageScreenshot; status: AtlasPageShotStatus }): string {
  return (
    `<figcaption><code>${escapeHtml({ value: shot.providerId })}</code> · ${escapeHtml({ value: shot.surface })} · ` +
    `${String(shot.byteLength)} bytes · <code>${escapeHtml({ value: shot.sha256.slice(0, 12) })}</code><br />` +
    `${escapeHtml({ value: SHOT_STATUS_WORDS[status] })}</figcaption>`
  );
}

/** One screenshot with no picture to show: its stored path, marked broken unless the budget held it back. */
function picturelessFigure({ shot, status }: { shot: AtlasPageScreenshot; status: AtlasPageShotStatus }): string {
  const tone = status === "budget-held" ? "noshot" : "noshot broken";
  const caption = shotCaption({ shot, status });
  return `<figure class="shot"><div class="${tone}"><code>${escapeHtml({ value: shot.relativePath })}</code></div>${caption}</figure>`;
}
