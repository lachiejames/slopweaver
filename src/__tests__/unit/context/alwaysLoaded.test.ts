/**
 * The always-loaded context block, and the two properties the ruling actually rests on.
 *
 * First: a section that could not be read PRINTS and says why. Omitting it would leave a session unable to
 * tell "the owner has no recorded ways of working" from "the database was down", and only one of those is a
 * reason to go and look somewhere else.
 *
 * Second: the marker is a constant. The delivery proof for the hook is the presence of that exact string
 * in a real session's context, and a witness each caller spelled for itself is a witness that drifts —
 * which would make the negative control (break the registration, watch the marker vanish) untrustworthy.
 */
import { describe, expect, it } from "vitest";

import {
  ALWAYS_LOADED_MARKER,
  type AlwaysLoadedSection,
  buildAlwaysLoadedContext,
  contextHeaderLines,
  STALE_CACHE_PREFIX,
  unavailableSection,
} from "../../../context/alwaysLoaded.js";

/** One loaded section, so a case can vary exactly one field off it. */
const LOADED: AlwaysLoadedSection = {
  detail: "",
  lines: ["- the owner only speaks to the supervisor"],
  provider: "owner-profile",
  revision: 4,
  status: "loaded",
  title: "About the owner",
};

describe("buildAlwaysLoadedContext", () => {
  it("opens with the marker a delivery proof greps for", () => {
    expect(buildAlwaysLoadedContext({ capturedAtIso: "2026-09-12T00:00:00.000Z", sections: [LOADED] })[0]).toBe(
      `${ALWAYS_LOADED_MARKER} — read at 2026-09-12T00:00:00.000Z`,
    );
  });

  it("carries the revision on a loaded heading, so two renders are distinguishable", () => {
    expect(buildAlwaysLoadedContext({ capturedAtIso: "2026-09-12T00:00:00.000Z", sections: [LOADED] })).toStrictEqual([
      `${ALWAYS_LOADED_MARKER} — read at 2026-09-12T00:00:00.000Z`,
      "## About the owner (revision 4)",
      "- the owner only speaks to the supervisor",
    ]);
  });

  it("prints an unavailable section rather than omitting it", () => {
    const failed = unavailableSection({
      detail: "connection refused",
      provider: "owner-profile",
      title: "About the owner",
    });
    expect(buildAlwaysLoadedContext({ capturedAtIso: "2026-09-12T00:00:00.000Z", sections: [failed] })).toStrictEqual([
      `${ALWAYS_LOADED_MARKER} — read at 2026-09-12T00:00:00.000Z`,
      "## About the owner",
      "unavailable: connection refused",
    ]);
  });

  it("distinguishes a genuinely empty section from an unreadable one", () => {
    const empty: AlwaysLoadedSection = { ...LOADED, detail: "nothing recorded yet", lines: [], status: "empty" };
    expect(buildAlwaysLoadedContext({ capturedAtIso: "2026-09-12T00:00:00.000Z", sections: [empty] })[2]).toBe(
      "empty: nothing recorded yet",
    );
  });

  it("says nothing at all only when there are no sections, which is the one silence it produces", () => {
    expect(buildAlwaysLoadedContext({ capturedAtIso: "2026-09-12T00:00:00.000Z", sections: [] })).toStrictEqual([]);
  });

  it("stamps a cached block so it cannot pass itself off as a live read", () => {
    const lines = buildAlwaysLoadedContext({
      capturedAtIso: "2026-09-11T00:00:00.000Z",
      sections: [LOADED],
      staleReason: "captured 1440 minute(s) ago",
    });
    expect(lines[1]).toBe(`${STALE_CACHE_PREFIX}: captured 1440 minute(s) ago`);
  });
});

describe("contextHeaderLines", () => {
  it("is the one place the marker is spelled, so the cache path and the live path cannot drift", () => {
    expect(contextHeaderLines({ capturedAtIso: "2026-09-12T00:00:00.000Z" })).toStrictEqual([
      `${ALWAYS_LOADED_MARKER} — read at 2026-09-12T00:00:00.000Z`,
    ]);
  });
});
