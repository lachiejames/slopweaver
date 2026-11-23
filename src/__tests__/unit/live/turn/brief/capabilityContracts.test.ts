/**
 * `renderCapabilityContracts` — the available, historical and unavailable capability sections of the brief,
 * each always headed, and `none` under an empty one. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { renderCapabilityContracts } from "../../../../../live/turn/briefCapabilityContracts.js";
import { AVAILABLE_CAPABILITY, HISTORICAL_CAPABILITY, UNAVAILABLE_CAPABILITY } from "./harness.js";

describe("renderCapabilityContracts", () => {
  it("lists the available, historical and unavailable capabilities in three separate sections", () => {
    const text = renderCapabilityContracts({
      available: [AVAILABLE_CAPABILITY],
      historical: [HISTORICAL_CAPABILITY],
      unavailable: [UNAVAILABLE_CAPABILITY],
    }).join("\n");
    expect(text).toContain("AVAILABLE CAPABILITIES");
    expect(text).toContain("github-vulnerability-report [available]");
    expect(text).toContain("corpus [HISTORICAL] — history/read/corpus");
    expect(text).toContain("production-logs [UNAVAILABLE]");
  });

  it("says `none` for every empty section, so an empty HISTORICAL reads as a fact rather than as an absent contract", () => {
    const text = renderCapabilityContracts({ available: [], historical: [], unavailable: [] }).join("\n");
    expect(text).toContain(
      "AVAILABLE CAPABILITIES — current truth, and the only legs that can establish present state:\n    - none",
    );
    expect(text).toContain(
      "HISTORICAL (reachable, and what was said/decided/recorded — selectable, but never proof of present state):\n    - none",
    );
    expect(text).toContain("UNAVAILABLE (known, unreachable from here — never a selectable live need):\n    - none");
  });

  it("renders the historical section even when the brief carries no history at all — never omits the heading", () => {
    const headings = renderCapabilityContracts({
      available: [AVAILABLE_CAPABILITY],
      historical: [],
      unavailable: [],
    }).filter((line) => !line.startsWith("    ") && !line.startsWith("      "));
    expect(headings.length).toBe(3);
  });
});
