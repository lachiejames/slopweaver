import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH004 — scheduler activation", () => {
  it("flags every mutating launchctl subcommand, and only those", () => {
    const content = [
      "launchctl bootstrap gui/501 job.plist",
      "launchctl load job.plist",
      "launchctl kickstart -k gui/501/job",
      "launchctl start job",
      "launchctl submit -l job -- /bin/true",
    ].join("\n");
    const hits = scanNoHeadless({ content, path: "scripts/run.sh" });
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.kind === "NH004")).toBe(true);
  });

  it("does NOT flag read-only launchctl list/print", () => {
    const content = ["launchctl list", "launchctl print gui/501/job"].join("\n");
    expect(scanNoHeadless({ content, path: "scripts/run.sh" })).toEqual([]);
  });

  it("does NOT flag the bare word launchd/launchctl in prose", () => {
    const content = "No launchd job, no daemon — see launchctl(1) for the read-only inspection verbs.";
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });
});
