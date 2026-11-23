/**
 * Where a stamp's chrome lands: around a fragment, or inside the fragment of a whole published page with the
 * shell kept outermost and unchanged — chrome ahead of the doctype once threw a page into quirks mode.
 */
import { describe, expect, it } from "vitest";

import { withCorrectionChrome } from "../../../../outbound/briefing/correctionsChrome.js";
import { PLATFORM_SHELL_OPEN, SHELL_CLOSE, SHELL_OPEN, wrapPageFragment } from "../../../../pages/shell.js";

const STRIP = '<p class="corr">STRIP</p>';
const EYEBROW = '<div class="eyebrow">refreshed</div>';

describe("withCorrectionChrome", () => {
  it("puts the stylesheet first and the strip directly after the eyebrow of a bare fragment", () => {
    const html = withCorrectionChrome({ html: `<main>${EYEBROW}<p>body</p></main>`, strip: STRIP });
    expect(html.startsWith('<style data-corr-style="1">')).toBe(true);
    expect(html.endsWith(`<main>${EYEBROW}\n  ${STRIP}<p>body</p></main>`)).toBe(true);
  });

  it("leads with the strip when the fragment has no eyebrow", () => {
    const html = withCorrectionChrome({ html: "<p>body</p>", strip: STRIP });
    expect(html.endsWith(`</style>\n${STRIP}<p>body</p>`)).toBe(true);
  });

  it("ignores an eyebrow quoted inside a script", () => {
    const fragment = `<script>const s = '${EYEBROW}';</script><p>body</p>`;
    const html = withCorrectionChrome({ html: fragment, strip: STRIP });
    expect(html.endsWith(`</style>\n${STRIP}${fragment}`)).toBe(true);
  });

  it("places the chrome inside a page in the current shell, keeping the doctype first", () => {
    const html = withCorrectionChrome({ html: wrapPageFragment({ fragment: `${EYEBROW}<p>x</p>` }), strip: STRIP });
    expect(html.startsWith(`${SHELL_OPEN}<style data-corr-style="1">`)).toBe(true);
    expect(html.endsWith(`${EYEBROW}\n  ${STRIP}<p>x</p>${SHELL_CLOSE}`)).toBe(true);
  });

  it("keeps the platform shell a page was published in", () => {
    const page = `${PLATFORM_SHELL_OPEN}${EYEBROW}<p>x</p>${SHELL_CLOSE}`;
    const html = withCorrectionChrome({ html: page, strip: STRIP });
    expect(html.startsWith(`${PLATFORM_SHELL_OPEN}<style data-corr-style="1">`)).toBe(true);
    expect(html.includes(SHELL_OPEN)).toBe(false);
  });
});
