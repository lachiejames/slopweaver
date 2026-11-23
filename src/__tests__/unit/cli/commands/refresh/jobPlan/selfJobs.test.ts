/**
 * `buildSelfJobs`: the `self` job planned beside the windowed sources, nothing without roots or a wired builder,
 * otherwise one epoch-wide job over every root.
 */
import { describe, expect, it } from "vitest";
import { buildSelfJobs } from "../../../../../../cli/commands/refresh/jobPlan.js";
import { ALL_WIRED, fakeDeps, HOME, job, NONE_WIRED } from "./fakeDeps.js";

describe("buildSelfJobs", () => {
  // Both "plans nothing" cases run with and without exclusions, so neither gate is conjoined with the exclude list.
  it.each([{ selfExclude: ["drafts-echo/"] }, { selfExclude: [] }])(
    "plans nothing for an empty root list even with a builder wired (exclude $selfExclude)",
    ({ selfExclude }) => {
      const cap = fakeDeps({ jobs: {}, wired: ALL_WIRED });

      const jobs = buildSelfJobs({ deps: cap.deps, home: HOME, selfExclude, selfRoots: [], until: "2026-03-16" });

      expect(jobs).toStrictEqual([]);
      expect(cap.self).toStrictEqual([]);
      expect(cap.info).toStrictEqual([]);
    },
  );

  it.each([{ selfExclude: [] }, { selfExclude: ["drafts-golf/"] }])(
    "plans nothing when roots are given but no self builder is wired (exclude $selfExclude)",
    ({ selfExclude }) => {
      const cap = fakeDeps({ jobs: {}, wired: NONE_WIRED });

      const jobs = buildSelfJobs({
        deps: cap.deps,
        home: HOME,
        selfExclude,
        selfRoots: ["/root-foxtrot"],
        until: "2026-03-16",
      });

      expect(jobs).toStrictEqual([]);
      expect(cap.info).toStrictEqual([]);
    },
  );

  it("builds one epoch-wide self job over every root and says so", () => {
    const selfJob = job({ label: "label-wren", source: "self", window: { since: "1970-01-01", until: "2026-03-18" } });
    const cap = fakeDeps({ jobs: { self: selfJob }, wired: ALL_WIRED });

    const jobs = buildSelfJobs({
      deps: cap.deps,
      home: "/home-golf",
      selfExclude: ["drafts-hotel/"],
      selfRoots: ["/root-india", "/root-juliet"],
      until: "2026-03-18",
    });

    expect(jobs).toStrictEqual([selfJob]);
    expect(cap.self).toStrictEqual([
      {
        exclude: ["drafts-hotel/"],
        home: "/home-golf",
        roots: ["/root-india", "/root-juliet"],
        window: { since: "1970-01-01", until: "2026-03-18" },
      },
    ]);
    expect(cap.info).toStrictEqual(["refresh self · 2 root(s) · full re-scan, no cursor"]);
  });

  it("builds the self job with no exclusions at all, so an empty exclude list never stops it", () => {
    const selfJob = job({ label: "label-kite", source: "self", window: { since: "1970-01-01", until: "2026-03-19" } });
    const cap = fakeDeps({ jobs: { self: selfJob }, wired: ALL_WIRED });

    const jobs = buildSelfJobs({
      deps: cap.deps,
      home: "/home-lima",
      selfExclude: [],
      selfRoots: ["/root-mike"],
      until: "2026-03-19",
    });

    expect(jobs).toStrictEqual([selfJob]);
    expect(cap.self).toStrictEqual([
      { exclude: [], home: "/home-lima", roots: ["/root-mike"], window: { since: "1970-01-01", until: "2026-03-19" } },
    ]);
    expect(cap.info).toStrictEqual(["refresh self · 1 root(s) · full re-scan, no cursor"]);
  });
});
