/**
 * The desktop app's deep link as this side mints it: one `path` query on `slopweaver://open`, percent-encoded.
 */
import { describe, expect, it } from "vitest";

import { desktopDeepLink, pageDesktopLink } from "../../../desktop/deepLink.js";

describe("desktopDeepLink", () => {
  it("carries a console path, its query and hash, as the one path parameter", () => {
    const link = desktopDeepLink({ path: "/queue?open=ask:abc-1#top" })!;
    expect(link).toBe("slopweaver://open?path=%2Fqueue%3Fopen%3Dask%3Aabc-1%23top");
    expect([...new URL(link).searchParams.keys()]).toEqual(["path"]);
    expect(new URL(link).searchParams.get("path")).toBe("/queue?open=ask:abc-1#top");
  });

  it("mints nothing for a path the app would drop, so no caller hands it a link that opens nothing", () => {
    const refused = ["/queue?q=\\evil", "//evil.example/queue", "queue", "/voice", "/voice?call=1", "/voice#x"];
    expect(refused.map((path) => desktopDeepLink({ path }))).toEqual(refused.map(() => undefined));
  });

  it("still mints a path that only starts with the overlay's name", () => {
    expect(desktopDeepLink({ path: "/voice-notes" })).toBe("slopweaver://open?path=%2Fvoice-notes");
  });
});

describe("pageDesktopLink", () => {
  it("opens a published page's console path", () => {
    expect(pageDesktopLink({ slug: "fleet-briefing-2-nov" })).toBe(
      "slopweaver://open?path=%2Fapi%2Fpage%2Ffleet-briefing-2-nov%2Findex.html",
    );
  });

  it("keeps the punctuation a slug admits", () => {
    expect(new URL(pageDesktopLink({ slug: "v1.2_a-b" })).searchParams.get("path")).toBe(
      "/api/page/v1.2_a-b/index.html",
    );
  });
});
