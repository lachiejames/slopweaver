import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DesktopE2eErrors } from "../../../desktop/e2eErrors.js";
import { e2ePageFixture, FIXTURE_MARKER, isE2ePageFixtureSlug } from "../../../desktop/e2eFixture.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { SHELL_CLOSE, SHELL_OPEN } from "../../../pages/shell.js";

describe("e2ePageFixture", () => {
  const fixture = unwrap(e2ePageFixture({ home: "/h", nonce: "0f3c" }));

  it("names the walk's own page under the home, by a slug carrying the nonce", () => {
    expect([fixture.slug, fixture.path]).toEqual(["desktop-e2e-0f3c", "/h/pages/desktop-e2e-0f3c/index.html"]);
  });

  it("publishes the same bytes on every walk, keyed by their own digest", () => {
    const other = unwrap(e2ePageFixture({ home: "/elsewhere", nonce: "9a1b" }));
    expect(other.html).toBe(fixture.html);
    expect(other.bodySha256).toBe(fixture.bodySha256);
    expect(fixture.bodySha256).toBe(createHash("sha256").update(fixture.html).digest("hex"));
    expect(fixture.html).toBe(SHELL_OPEN + fixture.fragment + SHELL_CLOSE);
  });

  it("asks the viewer for exactly the page's own index, its back control at the Queue", () => {
    expect([fixture.framePath, fixture.viewerPath]).toEqual([
      "/api/page/desktop-e2e-0f3c/index.html",
      "/view?back=%2Fqueue&src=%2Fapi%2Fpage%2Fdesktop-e2e-0f3c%2Findex.html",
    ]);
  });

  it("writes exactly the shell around a title and the one marked heading the step waits for", () => {
    expect(fixture.html).toBe(
      SHELL_OPEN +
        "<title>Desktop end to end: published page</title>\n" +
        `<main ${FIXTURE_MARKER}><h1>Published page viewer</h1>` +
        "<p>A walk of the desktop app wrote this page and removes it when the walk ends.</p></main>\n" +
        SHELL_CLOSE,
    );
  });

  it("authors nothing that runs or loads: no script, image, stylesheet, frame, form or address", () => {
    const authored = fixture.html.slice(SHELL_OPEN.length, -SHELL_CLOSE.length);
    expect(authored.match(/<(script|img|link|iframe|form|object|embed)\b|https?:|url\(/giu)).toBe(null);
  });

  it("refuses a nonce that makes no valid page slug", () => {
    expect(unwrapErr(e2ePageFixture({ home: "/h", nonce: "a/b" }))).toEqual(
      DesktopE2eErrors.pageFixtureUnplanned({ slug: "desktop-e2e-a/b" }),
    );
    expect(unwrapErr(e2ePageFixture({ home: "/h", nonce: "" })).code).toBe("PAGE_FIXTURE_UNPLANNED");
  });
});

describe("isE2ePageFixtureSlug", () => {
  it("holds only for the prefix, a nonce and a valid page slug", () => {
    const slugs = ["desktop-e2e-0f3c", "desktop-e2e-", "desktop-e2e-a/b", "standup-brief", "x-desktop-e2e-1"];
    expect(slugs.map((slug) => isE2ePageFixtureSlug({ slug }))).toEqual([true, false, false, false, false]);
  });
});
