import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readResyncDemand } from "../../../../live/resync/demandRead.js";

const dirs: string[] = [];

/** A throwaway home, removed after each test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "demand-read-"));
  dirs.push(dir);
  return dir;
}

describe("readResyncDemand", () => {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  it("leaves a corpus source, an unregistered platform and an atlas declaring no gate ungated", async () => {
    const reads = await Promise.all([
      readResyncDemand({ home: home(), sinceIso: null, target: { kind: "corpus", source: "slack" } }),
      readResyncDemand({ home: home(), sinceIso: null, target: { kind: "atlas", platform: "no-such-atlas" } }),
      readResyncDemand({ home: home(), sinceIso: null, target: { kind: "atlas", platform: "trelica" } }),
    ]);
    expect(reads).toEqual([{ kind: "ungated" }, { kind: "ungated" }, { kind: "ungated" }]);
  });

  it("defers a gated atlas on a home with no profile, whose fleet posts it could not tell from a person's", async () => {
    const read = await readResyncDemand({
      home: home(),
      sinceIso: null,
      target: { kind: "atlas", platform: "aether" },
    });
    expect(read).toEqual({
      kind: "unreadable",
      why: "profile.json names no slackBot ids, so the fleet's own posts cannot be told apart from a person's",
    });
  });

  it.each([
    ["no ids", {}],
    ["only blank ids", { botUserIds: [" "], ownerUserId: "U0OWNER", selfUserIds: [""] }],
  ])("defers a gated atlas whose profile has a slackBot block naming %s", async (_label, slackBot) => {
    const dir = home();
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({
        displayName: "Test",
        gitNamespace: "test",
        id: "test",
        schemaVersion: 1,
        slackBot,
        sources: [],
      }),
    );
    const read = await readResyncDemand({ home: dir, sinceIso: null, target: { kind: "atlas", platform: "aether" } });
    expect(read).toEqual({
      kind: "unreadable",
      why: "profile.json names no slackBot ids, so the fleet's own posts cannot be told apart from a person's",
    });
  });

  it("defers a gated atlas whose last success is not a time, which would otherwise hide every mention", async () => {
    const read = await readResyncDemand({
      home: home(),
      sinceIso: "not-a-date",
      target: { kind: "atlas", platform: "aether" },
    });
    expect(read).toEqual({
      kind: "unreadable",
      why: "the resync state's last success not-a-date is not a time, so what is newer than it cannot be told",
    });
  });

  it("defers a gated atlas whose profile will not read, rather than guessing whose posts are the fleet's", async () => {
    const dir = home();
    writeFileSync(join(dir, "profile.json"), "{ not json");
    const read = await readResyncDemand({ home: dir, sinceIso: null, target: { kind: "atlas", platform: "aether" } });
    expect(read.kind).toBe("unreadable");
    expect((read as Extract<typeof read, { kind: "unreadable" }>).why).toContain(
      "profile.json would not read, so the fleet's own posts cannot be told apart",
    );
  });
});
