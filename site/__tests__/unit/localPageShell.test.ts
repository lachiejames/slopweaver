/*
 * The console's copy of the page shell: equal to `src/pages/shell.ts`'s byte for byte, and the re-wrap that serves
 * an old page in the current shell while leaving every other document exactly as it was read.
 */

import { describe, expect, it } from "vitest";

import * as source from "../../../src/pages/shell";
import { houseStyledPage, PLATFORM_SHELL_OPEN, SHELL_CLOSE, SHELL_OPEN } from "../../lib/localPageShell";

const FRAGMENT = "<title>Café — ☕</title><h1>x & y</h1>\n<p>body</p>\n";
const CHROME = '<style data-corr-style="1">\n  .corr { margin: 0; }\n</style>\n';

describe("the restated shell", () => {
  it("is src/pages/shell.ts's, byte for byte", () => {
    expect([PLATFORM_SHELL_OPEN, SHELL_OPEN, SHELL_CLOSE]).toEqual([
      source.PLATFORM_SHELL_OPEN,
      source.SHELL_OPEN,
      source.SHELL_CLOSE,
    ]);
  });
});

describe("houseStyledPage", () => {
  it("re-wraps a platform-shell page in the current shell, the fragment untouched", () => {
    expect(houseStyledPage({ html: `${PLATFORM_SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}` })).toBe(
      source.wrapPageFragment({ fragment: FRAGMENT }),
    );
  });

  it("re-wraps an authored page too, since the current shell gives it the platform reset", () => {
    const fragment = "<title>t</title><style>body{max-width:680px}</style><h1>t</h1>";
    expect(houseStyledPage({ html: `${PLATFORM_SHELL_OPEN}${fragment}${SHELL_CLOSE}` })).toBe(
      `${SHELL_OPEN}${fragment}${SHELL_CLOSE}`,
    );
  });

  it("returns a page already in the current shell byte for byte", () => {
    const html = source.wrapPageFragment({ fragment: FRAGMENT });
    expect(houseStyledPage({ html })).toBe(html);
  });

  it("moves correction chrome stamped before a platform page's doctype inside its body", () => {
    expect(houseStyledPage({ html: `${CHROME}${PLATFORM_SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}` })).toBe(
      `${SHELL_OPEN}${CHROME}${FRAGMENT}${SHELL_CLOSE}`,
    );
  });

  it("moves correction chrome stamped before a current page's doctype inside its body", () => {
    expect(houseStyledPage({ html: `${CHROME}${SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}` })).toBe(
      `${SHELL_OPEN}${CHROME}${FRAGMENT}${SHELL_CLOSE}`,
    );
  });

  it("returns a hand-written document byte for byte", () => {
    const html = "<!doctype html><html><head><style>p{}</style></head><body><p>x</p></body></html>";
    expect(houseStyledPage({ html })).toBe(html);
  });

  it("returns a bare fragment byte for byte", () => {
    expect(houseStyledPage({ html: FRAGMENT })).toBe(FRAGMENT);
  });

  it("returns a platform page missing its close byte for byte", () => {
    const html = `${PLATFORM_SHELL_OPEN}${FRAGMENT}`;
    expect(houseStyledPage({ html })).toBe(html);
  });

  it("returns correction chrome over an unrecognised document byte for byte", () => {
    const html = `${CHROME}<p>x</p>`;
    expect(houseStyledPage({ html })).toBe(html);
  });
});
