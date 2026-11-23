/**
 * Composing two captured `yarn why` screenshots into one labelled, side-by-side golden-proof image.
 *
 * Pure JS throughout via `jimp` — deliberately NOT `sharp`: `package.json` already portals `sharp` to a
 * no-op stub ({@link ../../../stubs/sharp/index.js}) because it is a native binary that breaks
 * cross-platform installs, and that portal resolves for any code importing `"sharp"` repo-wide. Jimp has
 * no native dependency and bundles its own bitmap fonts (`jimp/fonts`), so it needs nothing at runtime
 * beyond what `yarn install` already fetched.
 *
 * No Jimp value ever crosses a function boundary through a declared parameter or return type below, and
 * there is no `as` assertion anywhere. Both would need to NAME a Jimp instance type, and Jimp's own
 * generic mixin types make any such name (`JimpInstance`, or a hand-rolled structural interface reusing
 * its `write`/`crop`/`clone` methods) compare as "two different types with this name" against a fresh
 * `new Jimp(...)` or `.clone()` result under this repo's `exactOptionalPropertyTypes` — even against
 * itself. Every Jimp value here is used only inside the one function that created it, with its own
 * freshly-inferred type, exactly the shape `pixels.ts`'s `findLastContentRow` sidesteps by taking a
 * separate minimal `PixelSource` interface instead.
 */
import { Jimp, loadFont } from "jimp";
import { SANS_16_WHITE, SANS_32_WHITE } from "jimp/fonts";

import { err, ok, type Result } from "../../lib/result.js";
import { type YarnWhyError, YarnWhyErrors } from "./errors.js";
import { findLastContentRow, packRgba } from "./pixels.js";

const CANVAS_BG = 0x14161cff;
const BANNER_BG_NEUTRAL = 0x1c1f28ff;
const BANNER_BG_CHANGED = 0x3a2a12ff;
const HEADER_H = 44;
const BANNER_H = 40;
const GAP = 24;
const PAD = 24;
const TITLE_H = 56;
/** Blank rows kept below the last detected content row, so the crop doesn't hug the text too tightly. */
const BOTTOM_MARGIN = 20;

/** One pane's inputs: its screenshot, its human label, and the real resolved-version text for its caption. */
export interface PaneInput {
  readonly imagePath: string;
  readonly label: string;
  readonly resolved: string;
}

/** The two fonts this compositor needs, loaded once and reused across both panes. */
interface Fonts {
  readonly title: Awaited<ReturnType<typeof loadFont>>;
  readonly label: Awaited<ReturnType<typeof loadFont>>;
}

async function loadFonts(): Promise<Fonts> {
  return { label: await loadFont(SANS_16_WHITE), title: await loadFont(SANS_32_WHITE) };
}

/**
 * Whether a path ends in `.png` — narrows a plain string to Jimp's own template-literal `write` parameter
 * type through real control flow, never a cast.
 *
 * @param path the path to check
 * @returns whether it ends in `.png`
 */
function isPngPath(path: string): path is `${string}.png` {
  return path.endsWith(".png");
}

/** The banner fill color for one pane, chosen once per compose rather than re-decided per pane. */
function bannerColor({ changed }: { changed: boolean }): number {
  return changed ? BANNER_BG_CHANGED : BANNER_BG_NEUTRAL;
}

/** Build one labelled pane: a header banner with its screenshot below, then a resolved-version caption. */
async function buildPane({ pane, changed, fonts }: { pane: PaneInput; changed: boolean; fonts: Fonts }) {
  const raw = await Jimp.read(pane.imagePath);
  const cropHeight = Math.min(raw.height, findLastContentRow({ image: raw }) + 1 + BOTTOM_MARGIN);
  const shot = raw.clone().crop({ h: cropHeight, w: raw.width, x: 0, y: 0 });

  const canvas = new Jimp({ color: CANVAS_BG, height: HEADER_H + shot.height + BANNER_H, width: shot.width });
  canvas.print({ font: fonts.label, text: pane.label, x: 0, y: 12 });
  canvas.composite(shot, 0, HEADER_H);

  const bannerY = HEADER_H + shot.height;
  const fillColor = bannerColor({ changed });
  canvas.scan(0, bannerY, canvas.width, BANNER_H, function writeBannerPixel(this: typeof canvas, _x, _y, idx) {
    this.bitmap.data.writeUInt32BE(fillColor, idx);
  });
  canvas.print({ font: fonts.label, text: `resolved: ${pane.resolved}`, x: 0, y: bannerY + 9 });
  return canvas;
}

/**
 * Compose the full golden-proof image: a title naming the dependency, then the "before" and "after" panes
 * side by side, each showing its real captured screenshot and its real resolved-version caption.
 *
 * @param dependency the dependency name shown in the title
 * @param before the "before" (e.g. staging) pane's inputs
 * @param after the "after" (e.g. PR-branch) pane's inputs
 * @param outPath where to write the composed PNG — must end in `.png`
 * @returns ok once the file is written, or the error message on failure
 */
export async function composeGoldenProof({
  dependency,
  before,
  after,
  outPath,
}: {
  dependency: string;
  before: PaneInput;
  after: PaneInput;
  outPath: string;
}): Promise<Result<void, YarnWhyError>> {
  if (!isPngPath(outPath)) {
    return err(YarnWhyErrors.outputPathInvalid({ outPath }));
  }

  try {
    const changed = before.resolved !== after.resolved;
    const fonts = await loadFonts();
    const [paneA, paneB] = await Promise.all([
      buildPane({ changed, fonts, pane: before }),
      buildPane({ changed, fonts, pane: after }),
    ]);

    const paneWidth = Math.max(paneA.width, paneB.width);
    const paneHeight = Math.max(paneA.height, paneB.height);
    const canvasWidth = PAD * 2 + paneWidth * 2 + GAP;
    const canvasHeight = PAD * 2 + TITLE_H + paneHeight;

    const canvas = new Jimp({ color: CANVAS_BG, height: canvasHeight, width: canvasWidth });
    canvas.print({ font: fonts.title, text: `yarn why ${dependency}`, x: PAD, y: PAD });
    canvas.composite(paneA, PAD, PAD + TITLE_H);
    canvas.composite(paneB, PAD + paneWidth + GAP, PAD + TITLE_H);

    if (changed) {
      const stripeColor = packRgba({ a: 255, b: 70, g: 160, r: 220 });
      const stripeY = canvasHeight - 4;
      canvas.scan(0, stripeY, canvasWidth, 4, function writeStripePixel(this: typeof canvas, _x, _y, idx) {
        this.bitmap.data.writeUInt32BE(stripeColor, idx);
      });
    }

    await canvas.write(outPath);
    return ok(undefined);
  } catch (error: unknown) {
    return err(YarnWhyErrors.composeFailed({ cause: error }));
  }
}
