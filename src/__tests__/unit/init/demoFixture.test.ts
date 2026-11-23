import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { bronzeDir } from "../../../corpus/corpusPaths.js";
import { writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import { memberIdentityCandidates } from "../../../corpus/members/project.js";
import { groupForDistil } from "../../../gold/distilGroup.js";
import { DEMO_WINDOW, demoRecords, LINEAR_TRACKER_SYNC_ID, SLACK_DEPLOY_BOT_ID } from "../../../init/demoFixture.js";
import { demoMembers } from "../../../init/demoMembers.js";
import { ok, unwrap } from "../../../lib/result.js";
import { deriveSilver } from "../../../silver/deriveSilver.js";
import { resolveFromRecords } from "../../../silver/personResolver.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

describe("demo fixture round-trip through the real seams", () => {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("writes via the production writer and reads back every record", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-demo-"));
    fixtureDirs.push(home);
    const records = demoRecords();
    const written = writeCorpusRecords({ home, protection: NO_ENTRIES, records, window: DEMO_WINDOW });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).written).toBe(records.length);

    const readBack = readCorpusDir({ dir: bronzeDir({ home }), home, protection: NO_ENTRIES });
    const back = unwrap(readBack).records;
    expect(back).toHaveLength(records.length);
    expect([...new Set(back.map((r) => r.source))].toSorted()).toStrictEqual(["github", "linear", "notion", "slack"]);
  });

  it("groups into one distil batch per container (6 containers)", () => {
    const batches = groupForDistil({ promptVersion: "testfp", records: demoRecords() });
    expect(batches).toHaveLength(6);
  });

  it("derives each GitHub record's source id and url from one address, a reply suffixed on both", () => {
    expect(
      demoRecords()
        .filter((r) => r.source === "github")
        .map((r) => [r.sourceId, r.url]),
    ).toEqual([
      ["#101", "https://demo.example.com/web/pull/101"],
      ["#101:review:0", "https://demo.example.com/web/pull/101#review"],
      ["#101:comment:0", "https://demo.example.com/web/pull/101#comment"],
      ["#102", "https://demo.example.com/web/pull/102"],
      ["#7", "https://demo.example.com/api/issues/7"],
      ["#205", "https://demo.example.com/api/pull/205"],
      ["#110", "https://demo.example.com/web/issues/110"],
      ["#7:comment:0", "https://demo.example.com/api/issues/7#comment"],
    ]);
  });

  it("is hygiene-clean: no absolute home paths in any record text or url", () => {
    const blob = demoRecords()
      .flatMap((r) => [r.url, r.text, r.title])
      .filter((s): s is string => s !== undefined)
      .join(" ");
    expect(/\/(?:Users|home)\//.test(blob)).toBe(false);
  });
});

describe("demo fixture — PR4.8 silver quality signals", () => {
  const artifacts = deriveSilver({
    identityMap: new Map(),
    memberRows: demoMembers(),
    records: demoRecords(),
    resolution: resolveFromRecords({
      extraCandidates: memberIdentityCandidates({ rows: demoMembers() }),
      records: demoRecords(),
      roster: [],
    }),
  });

  it("excludes the bot, the integration and the `[bot]` login from the people directory", () => {
    const ids = artifacts.directory.people.map((p) => p.id);
    expect(ids).not.toContain("Deploy Notifier");
    expect(ids).not.toContain("Tracker Sync");
    expect(ids).not.toContain("dependabot[bot]");
    expect(artifacts.directory.excludedPeople).toBe(3);
  });

  it("keeps the bot/integration records in the corpus — containers still count every record", () => {
    const total = artifacts.directory.containers.reduce((sum, c) => sum + c.recordCount, 0);
    expect(total).toBe(demoRecords().length);
    expect(artifacts.directory.containers.find((c) => c.id === "eng-general")!.recordCount).toBe(2);
  });

  it("labels the resolved bot + integration accounts with their exact kind and reason", () => {
    // Looked up by native id, not `displayName`: the bot/integration member rows are excluded from
    // linking (`isLinkableMember`), so nothing supplies their human-readable name to the resolved person —
    // its only identity comes from the record author, which IS the native id.
    const bot = artifacts.kindedPeople.find((p) => p.identities.some((i) => i.nativeId === SLACK_DEPLOY_BOT_ID))!;
    expect(bot.kind).toBe("bot");
    expect(bot.kindReasons).toStrictEqual(["member-profile-bot"]);
    const integration = artifacts.kindedPeople.find((p) =>
      p.identities.some((i) => i.nativeId === LINEAR_TRACKER_SYNC_ID),
    )!;
    expect(integration.kind).toBe("integration");
    expect(integration.kindReasons).toStrictEqual(["integration-email-domain"]);
  });

  it("drops the mined `@gmail` fragment and the shared `@ops-oncall` handle from cross-cutting", () => {
    expect(artifacts.opportunities.map((o) => o.subject)).not.toContain("@gmail");
    expect(artifacts.opportunities.map((o) => o.subject)).not.toContain("@ops-oncall");
    expect(artifacts.opportunityDrops.genericToken).toBe(1);
    expect(artifacts.opportunityDrops.mentionOnly).toBe(1);
  });

  it("keeps the concrete cross-cutting concern the demo threads through every source", () => {
    const concern = artifacts.opportunities.find((o) => o.kind === "cross-cutting" && o.subject === "PAY-1")!;
    expect(concern.summary).toBe("PAY-1 is referenced across 6 distinct containers");
  });
});
