/**
 * The instrument asked for before anything is designed to a number.
 *
 * Two independent attempts at the Linear settings walk stopped at different pages under different caps, and
 * BOTH at the same elapsed minute — so page count, elapsed time and memory moved together and the evidence
 * cannot say which is the ceiling. A line carrying all three is what makes the next drop self-diagnosing; a
 * line carrying only `<page>/<total>` never can, however many times it is run.
 *
 * `walkProgressLine` is pure and pinned exactly. `walkTicker` reads the clock, resident memory and the relay
 * register, so its cases pin what a LOOP depends on instead: the page half of the line, that the first tick
 * has no previous cost and the second one does, and that a rebuilt relay reaches the line without the loop
 * ever mentioning it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { walkProgressLine, walkTicker } from "../../../../atlas/kit/walkProgress.js";
import { noteRelayRecovery, takeRelayRecoveries } from "../../../../browser/walkStops.js";

afterEach(() => {
  takeRelayRecoveries();
});

/**
 * The instrument asked for before anything is designed to a number.
 *
 * Two independent attempts at the Linear settings walk stopped at different pages under different caps, and
 * BOTH at the same elapsed minute — so page count, elapsed time and memory moved together and the evidence
 * cannot say which is the ceiling. A line carrying all three is what makes the next drop self-diagnosing; a
 * line carrying only `<page>/<total>` never can, however many times it is run.
 */
describe("walkProgressLine", () => {
  it("carries the page, the clock and the memory on the first page, where there is no previous cost yet", () => {
    expect(
      walkProgressLine({
        label: "linear settings",
        page: "workspace-members",
        position: 1,
        previousPageMs: null,
        relayRebuilds: 0,
        rssBytes: 412 * 1_048_576,
        sinceStartMs: 0,
        total: 200,
      }),
    ).toBe("linear settings: 1/200 workspace-members (0.0s in, 412 MiB rss)");
  });

  it("reports the previous page's own cost, which is what separates a walk slowing down from one that did not", () => {
    expect(
      walkProgressLine({
        label: "linear settings",
        page: "workspace-labels",
        position: 120,
        previousPageMs: 6_200,
        relayRebuilds: 0,
        rssBytes: 1_024 * 1_048_576,
        sinceStartMs: 602_000,
        total: 200,
      }),
    ).toBe("linear settings: 120/200 workspace-labels (prev 6.2s, 10m02s in, 1024 MiB rss)");
  });

  it("names a rebuilt relay, so a walk that finished anyway still says the relay went", () => {
    expect(
      walkProgressLine({
        label: "linear settings",
        page: "workspace-teams",
        position: 121,
        previousPageMs: 41_800,
        relayRebuilds: 1,
        rssBytes: 1_030 * 1_048_576,
        sinceStartMs: 644_000,
        total: 200,
      }),
    ).toBe("linear settings: 121/200 workspace-teams (prev 41.8s, 10m44s in, 1030 MiB rss, 1 relay rebuild)");
  });

  it("pluralises more than one rebuild", () => {
    expect(
      walkProgressLine({
        label: "xero: browser-walk",
        page: "org-settings",
        position: 9,
        previousPageMs: 5_000,
        relayRebuilds: 3,
        rssBytes: 200 * 1_048_576,
        sinceStartMs: 60_000,
        total: 20,
      }),
    ).toBe("xero: browser-walk: 9/20 org-settings (prev 5.0s, 1m00s in, 200 MiB rss, 3 relay rebuilds)");
  });
});

describe("walkTicker", () => {
  it("gives a loop the page half of the line from the two things a loop knows", () => {
    const lines: string[] = [];
    const tick = walkTicker({ label: "linear settings", progress: (input) => lines.push(input.line), total: 200 });
    tick({ page: "workspace-members", position: 1 });
    tick({ page: "workspace-labels", position: 2 });
    expect(lines.map((line) => line.split(" (")[0])).toEqual([
      "linear settings: 1/200 workspace-members",
      "linear settings: 2/200 workspace-labels",
    ]);
  });

  it("carries no previous cost on the first tick and one on the second, which is the whole of its state", () => {
    const lines: string[] = [];
    const tick = walkTicker({ label: "aether console", progress: (input) => lines.push(input.line), total: 12 });
    tick({ page: "/users", position: 1 });
    tick({ page: "/groups", position: 2 });
    expect(lines[0]!).not.toContain("prev ");
    expect(lines[1]!).toContain("prev ");
  });

  it("reads the relay register itself, so a rebuilt relay reaches the line without the loop knowing", () => {
    takeRelayRecoveries();
    noteRelayRecovery({ reason: "Error: Session closed" });
    const lines: string[] = [];
    const tick = walkTicker({ label: "linear settings", progress: (input) => lines.push(input.line), total: 200 });
    tick({ page: "workspace-teams", position: 121 });
    expect(lines[0]!).toContain(", 1 relay rebuild)");
  });

  it("costs a walk nothing when no progress sink was given", () => {
    const tick = walkTicker({ label: "crowdstrike console", progress: undefined, total: 4 });
    expect(tick({ page: "/dashboard", position: 1 })).toBe(undefined);
  });
});
