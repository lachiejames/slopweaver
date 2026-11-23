/*
 * A local page address in prose is linkified, a file address that is not a page stays plain text, and the
 * renderer's own pattern matches the same address the shared `LOCAL_PAGE_URL_IN_TEXT` does.
 */
import { describe, expect, it } from "vitest";

import { renderNote } from "../../../../../outbound/briefing/render.js";
import { LOCAL_PAGE_URL_IN_TEXT } from "../../../../../pages/url.js";
import { text } from "./harness.js";

describe("a local page address in prose", () => {
  const PAGE = "file:///Users/x/.slopweaver/pages/queue-decision/index.html";

  it("linkifies, because it is the address the fleet now publishes", () => {
    const html = renderNote({ note: { headline: text({ value: `open ${PAGE} for the options` }) } });

    expect(html).toContain(`open <a class="raw" href="${PAGE}">${PAGE}</a> for the options`);
  });

  it("leaves a file address that is not a page as plain text — it is a path being discussed", () => {
    const html = renderNote({ note: { headline: text({ value: "see file:///tmp/run.log for the trace" }) } });

    expect(html).toContain("see file:///tmp/run.log for the trace");
    expect(html).not.toContain('href="file:///tmp/run.log"');
  });

  it("does not swallow an http URL written straight after a non-page file address", () => {
    // A Codex review pass found this: matching `file:` loosely CONSUMED both, and the skipped match took the
    // artifact URL with it, so a link that worked before the local-page change stopped working.
    const html = renderNote({
      note: { headline: text({ value: "file:///tmp/run.log,https://claude.ai/code/artifact/0dc1a3db" }) },
    });

    expect(html).toContain(
      '<a class="raw" href="https://claude.ai/code/artifact/0dc1a3db">https://claude.ai/code/artifact/0dc1a3db</a>',
    );
  });

  it("matches the same address the shared prose pattern does", () => {
    expect(PAGE.match(LOCAL_PAGE_URL_IN_TEXT)).toStrictEqual([PAGE]);
  });
});
