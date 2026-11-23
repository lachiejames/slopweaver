/**
 * The posting rule for a step whose `url` is a `file://` address — a POSTING rule, so rows already in the register,
 * written while the address was the documented shape, still read.
 *
 * Two reasons, each enough on its own. The Queue's hand reader (`site/components/live/read.ts`, `readHandSteps`) reads
 * a step's `url` as a web address, so ONE `file://` row blanked every hand card on the owner's Queue: a row carrying
 * `file:///…/pages/<slug>/index.html` made the corner read "your hands could not be read". And a page a card names
 * opens in the desktop app's viewer, so any HTML mentioned in a draft or card carries a citation to open it there. A
 * published page has that address already (`../pages/url.ts`'s `consoleViewerUrl`), so the refusal names it.
 *
 * Pure: no I/O. The console origin is the default one; a console moved with `SLOPWEAVER_CONSOLE_URL` changes only the
 * origin of the address the refusal suggests, never whether it refuses.
 */
import { consoleViewerUrl, localPageSlug } from "../pages/url.js";

import { consoleBaseFrom } from "./consoleLink.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/** A `file:` scheme, in any case, as `./stepAddress.ts`'s `LINK` admits one. */
const FILE_SCHEME = /^file:/iu;

/** A slug-alphabet stand-in, swapped for `<slug>` after encoding so the suggestion reads as a template. */
const SLUG_PLACEHOLDER = "SLUG";

/**
 * The refusal for a step whose `url` is a local file, or `undefined` when it is a web address or absent.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, naming the viewer address when the file is a published page, or `undefined`
 */
export function localFileUrl({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.url === undefined || !FILE_SCHEME.test(step.url)) {
    return undefined;
  }
  const slug = localPageSlug({ url: step.url });
  const consoleBase = consoleBaseFrom({ configured: undefined });
  const fix =
    slug === undefined
      ? "publish it as a page with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
        "`slopweaver page review-prepare`) and pass its viewer address, " +
        consoleViewerUrl({ consoleBase, slug: SLUG_PLACEHOLDER }).replace(SLUG_PLACEHOLDER, "<slug>")
      : `pass the page's viewer address instead: ${consoleViewerUrl({ consoleBase, slug })}`;
  return HandStepErrors.invalidField({
    field: "url",
    why:
      "is a file:// address, which the Queue cannot read as a link (one such card blanked every hand card on it) " +
      `and which opens outside the desktop app's viewer — ${fix}`,
  });
}
