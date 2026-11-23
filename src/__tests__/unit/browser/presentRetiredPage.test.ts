/**
 * `browser present` refusing a page the console no longer has: Board and Machine went with no redirect, so the
 * voice taking the owner to either would open a 404 — the router's own spelling of either, decoded once, is refused.
 */
import { describe, expect, it } from "vitest";

import { resolvePresentTarget } from "../../../browser/present.js";
import { unwrapErr } from "../../../lib/result.js";

describe("resolvePresentTarget, a retired page", () => {
  it.each([
    "http://localhost:3000/board",
    "http://localhost:3000/board?row=a-row",
    "http://127.0.0.1:3000/Machine/agents",
    "http://localhost:3000/%62oard",
    "http://localhost:3000/board%2F..%2Ffleet",
    "http://localhost:3000/%2Fmachine",
  ])("refuses %s as RETIRED_PAGE", (url) => {
    expect(
      unwrapErr(
        resolvePresentTarget({
          consoleBase: "http://localhost:3000",
          ddSite: undefined,
          pagePublished: () => false,
          request: { destination: undefined, page: undefined, url },
        }),
      ),
    ).toMatchObject({ cause: "RETIRED_PAGE", code: "CONSOLE_PATH_REFUSED" });
  });
});
