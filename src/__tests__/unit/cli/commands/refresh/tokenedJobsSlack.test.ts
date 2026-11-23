/**
 * The Slack leg of `refresh` refuses a corrupt `profile.json` before it fetches anything. Read as absent, the
 * owner's bot identity would vanish for the whole crawl, every record it wrote would be banked under the wrong
 * identity, and the channel cursors would move past them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ingestSlack } from "../../../../../cli/commands/refresh/tokenedJobsSlack.js";
import { unwrapErr } from "../../../../../lib/result.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("ingestSlack over a corrupt profile.json", () => {
  it("refuses before any fetch, naming the profile path", async () => {
    const home = mkdtempSync(join(tmpdir(), "slack-profile-"));
    dirs.push(home);
    writeFileSync(join(home, "profile.json"), "{");

    const outcome = await ingestSlack({
      home,
      nowIso: () => "2026-09-28T00:00:00.000Z",
      progress: {},
      slackChannels: [],
      token: "not-a-real-token",
      window: { since: "2026-09-27", until: "2026-09-28" },
    });

    const reasons = unwrapErr(outcome);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(join(home, "profile.json"));
    expect(reasons[0]).toContain("No Slack record was fetched.");
  });
});
