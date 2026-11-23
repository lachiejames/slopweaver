/**
 * The registration seam over the REAL `handover register`, in a throwaway home: the receipt this call reads is the
 * one the verb prints, the row it writes is dispatchable, and a second registration of the same channel — the
 * create race two sweeps can run — reads as `already-existed` instead of a refusal or a second row.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { incidentRowDocs, productionIncidentDetectDeps } from "../../../cli/commands/incident/deps.js";
import type { IncidentChannel } from "../../../incident/channel.js";
import { claimedIncidentChannelIds, claimIncidentChannel, incidentClaimPath } from "../../../incident/claim.js";
import { detectLiveIncidents } from "../../../incident/detect.js";
import type { IncidentDetectDeps } from "../../../incident/register.js";
import { incidentRowSlug } from "../../../incident/row.js";
import { readSeenChannelIds } from "../../../incident/seen.js";
import { ok, unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";
import { gitInTemp } from "../../tempGitRepo.js";

const NOW_MS = Date.parse("2026-10-04T05:00:00.000Z");
const LIVE: IncidentChannel = {
  createdEpochSeconds: NOW_MS / 1000 - 3600,
  id: "C0LIVE",
  name: "inc-2026-10-04-checkout-down",
  topic: "INC-80",
};

describe("detection over the real handover register", () => {
  let home: string;
  let checkout: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "incident-register-"));
    checkout = realpathSync(mkdtempSync(join(tmpdir(), "incident-checkout-")));
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(checkout, { force: true, recursive: true });
  });

  /**
   * Production register, row reader and ledger; the probe, checkout and organisation are the effects that need the
   * world — the organisation a store this lane does not have.
   */
  function deps(): IncidentDetectDeps {
    return {
      ...productionIncidentDetectDeps({ home, nowMs: NOW_MS }),
      checkout: () => ok(checkout),
      organisation: async () => ok(ACME_ORGANISATION),
      probe: async () => ({ principal: "user", readable: true, workspaceUrl: "https://acme.slack.com" }),
    };
  }

  it("creates one dispatch row naming the channel, and the next sweep is silent", async () => {
    const first = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    const slug = incidentRowSlug({ channel: LIVE });

    expect(first).toEqual({
      registered: [{ channelId: "C0LIVE", name: "inc-2026-10-04-checkout-down", outcome: "created", slug }],
      skipped: [],
    });
    const docs = unwrap(incidentRowDocs({ channelId: "C0LIVE", home }));
    expect(docs.map((doc) => doc.slug)).toEqual([slug]);
    expect(docs[0]!.text).toContain("channel C0LIVE, https://acme.slack.com/archives/C0LIVE,");
    expect([...unwrap(readSeenChannelIds({ home }))]).toEqual(["C0LIVE"]);

    const second = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS + 300_000 });
    expect(second).toEqual({ registered: [], skipped: [] });
    expect(readdirSync(stateHomePaths({ home }).handovers).filter((name) => name.endsWith(".md"))).toEqual([
      `${slug}.md`,
    ]);
  });

  it("reads a lost create race as already-existed, never as a refusal", async () => {
    await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    const forgetful: IncidentDetectDeps = { ...deps(), seen: () => ok(new Set()) };

    const raced = await detectLiveIncidents({ channels: [LIVE], deps: forgetful, home, nowMs: NOW_MS + 300_000 });

    expect(raced.skipped).toEqual([]);
    expect(raced.registered.map((one) => one.outcome)).toEqual(["already-existed"]);
  });

  it("never brings a settled row back as a second live row when the ledger missed it", async () => {
    await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    const slug = incidentRowSlug({ channel: LIVE });
    const paths = stateHomePaths({ home });
    // Settling moves the doc into the archive; an untagged `handover register` never looks there.
    mkdirSync(paths.handoverArchive, { recursive: true });
    renameSync(join(paths.handovers, `${slug}.md`), join(paths.handoverArchive, `${slug}.md`));
    const forgetful: IncidentDetectDeps = { ...deps(), seen: () => ok(new Set()) };

    const again = await detectLiveIncidents({ channels: [LIVE], deps: forgetful, home, nowMs: NOW_MS + 300_000 });

    expect(again.registered.map((one) => one.outcome)).toEqual(["already-existed"]);
    expect(readdirSync(paths.handovers).filter((name) => name.endsWith(".md"))).toEqual([]);
  });

  it("finds the settled row of a channel renamed since, by its id", async () => {
    await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    const slug = incidentRowSlug({ channel: LIVE });
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handoverArchive, { recursive: true });
    renameSync(join(paths.handovers, `${slug}.md`), join(paths.handoverArchive, `${slug}.md`));
    const renamed: IncidentChannel = { ...LIVE, name: "inc-2026-10-04-checkout-restored" };
    const forgetful: IncidentDetectDeps = { ...deps(), seen: () => ok(new Set()) };

    const again = await detectLiveIncidents({ channels: [renamed], deps: forgetful, home, nowMs: NOW_MS + 300_000 });

    expect(again.registered.map((one) => [one.outcome, one.slug])).toEqual([["already-existed", slug]]);
    expect(readdirSync(paths.handovers).filter((name) => name.endsWith(".md"))).toEqual([]);
  });

  it("writes ONE row when two overlapping sweeps see the channel either side of a rename", async () => {
    // Two sweeps are two processes; the interleaving is sweep B's pre-check landing BEFORE sweep A wrote its row,
    // and B's registration after. So B's first row-doc read answers "none", and every later one is the real board.
    const renamed: IncidentChannel = { ...LIVE, name: "inc-2026-10-04-checkout-restored" };
    const sweepA = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    let reads = 0;
    const stale: IncidentDetectDeps = {
      ...deps(),
      rowDocs: ({ channelId }) => {
        reads += 1;
        return reads === 1 ? ok([]) : incidentRowDocs({ channelId, home });
      },
      seen: () => ok(new Set()),
    };

    const sweepB = await detectLiveIncidents({ channels: [renamed], deps: stale, home, nowMs: NOW_MS });

    expect([...sweepA.registered, ...sweepB.registered].map((one) => [one.outcome, one.slug])).toEqual([
      ["created", "incident-c0live"],
      ["already-existed", "incident-c0live"],
    ]);
    expect(readdirSync(stateHomePaths({ home }).handovers).filter((name) => name.endsWith(".md"))).toEqual([
      "incident-c0live.md",
    ]);
  });

  it("writes no second row when the first is archived between a sweep's pre-check and its registration", async () => {
    await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });
    const slug = incidentRowSlug({ channel: LIVE });
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handoverArchive, { recursive: true });
    let reads = 0;
    const racing: IncidentDetectDeps = {
      ...deps(),
      // The pre-check answers stale ("no row"), and the hand move to the archive lands right after it.
      rowDocs: ({ channelId }) => {
        reads += 1;
        if (reads === 1) {
          renameSync(join(paths.handovers, `${slug}.md`), join(paths.handoverArchive, `${slug}.md`));
          return ok([]);
        }
        return incidentRowDocs({ channelId, home });
      },
      seen: () => ok(new Set()),
    };

    const again = await detectLiveIncidents({ channels: [LIVE], deps: racing, home, nowMs: NOW_MS + 300_000 });

    expect(again.registered.map((one) => [one.outcome, one.slug])).toEqual([["already-existed", slug]]);
    expect(readdirSync(paths.handovers).filter((name) => name.endsWith(".md"))).toEqual([]);
  });

  it("writes no row over a young claim with no doc — a sweep that may still be registering", async () => {
    // The crash window: the claim is written first, so a sweep killed before its doc leaves the claim and no row.
    const claim = unwrap(
      claimIncidentChannel({ atIso: "2026-10-04T04:55:00.000Z", channelId: "C0LIVE", holder: "dead-sweep", home }),
    );

    const report = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    expect(claim.state).toBe("claimed");
    expect(report.registered).toEqual([]);
    expect(report.skipped.map((one) => one.why)).toEqual([
      `${incidentClaimPath({ channelId: "C0LIVE", home })} claims this channel and no row doc names it yet — a sweep ` +
        "mid-registration, or one that died after claiming; a sweep takes it over once it is 30 minutes old",
    ]);
    expect(existsSync(stateHomePaths({ home }).handovers)).toBe(false);
  });

  it("takes over a dead sweep's claim once it is stale and writes the one row", async () => {
    unwrap(
      claimIncidentChannel({ atIso: "2026-10-04T04:29:59.000Z", channelId: "C0LIVE", holder: "dead-sweep", home }),
    );

    const report = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    expect(report.registered.map((one) => [one.outcome, one.slug])).toEqual([["created", "incident-c0live"]]);
    expect(readdirSync(stateHomePaths({ home }).handovers).filter((name) => name.endsWith(".md"))).toEqual([
      "incident-c0live.md",
    ]);
    // Restamped with the sweep's instant and its own holder id, which is minted fresh per sweep.
    expect(readFileSync(incidentClaimPath({ channelId: "C0LIVE", home }), "utf8")).toMatch(
      /^2026-10-04T05:00:00\.000Z [0-9a-f-]{36}\n$/u,
    );
  });

  it("still writes the row a sweep that crashed at the window's end owed, once its claim is stale", async () => {
    // Claimed at 47h50m, crashed before the doc; by the time the claim is stale the channel is past 48h.
    const aged: IncidentChannel = { ...LIVE, createdEpochSeconds: NOW_MS / 1000 - 48 * 3600 - 1200 };
    unwrap(
      claimIncidentChannel({ atIso: "2026-10-04T04:30:00.000Z", channelId: "C0LIVE", holder: "dead-sweep", home }),
    );

    const report = await detectLiveIncidents({ channels: [aged], deps: deps(), home, nowMs: NOW_MS });

    expect(report.registered.map((one) => [one.outcome, one.slug])).toEqual([["created", "incident-c0live"]]);
  });

  it("leaves the claim behind when the sweep dies during the probe, so the channel stays a candidate", async () => {
    const dying: IncidentDetectDeps = {
      ...deps(),
      probe: async () => {
        throw new Error("killed mid-probe");
      },
    };

    await expect(detectLiveIncidents({ channels: [LIVE], deps: dying, home, nowMs: NOW_MS })).rejects.toThrow(
      "killed mid-probe",
    );

    expect([...unwrap(claimedIncidentChannelIds({ home }))]).toEqual(["C0LIVE"]);
  });

  it("takes over a claim with no stamp — a sweep that died between creating the file and writing it", async () => {
    const path = incidentClaimPath({ channelId: "C0LIVE", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");

    const report = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    expect(report.registered.map((one) => one.outcome)).toEqual(["created"]);
  });

  it("keeps the claim once the row is written, so a lost ledger and a lost doc still register nothing twice", async () => {
    await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    const again = claimIncidentChannel({
      atIso: "2026-10-04T05:05:00.000Z",
      channelId: "C0LIVE",
      holder: "dead-sweep",
      home,
    });

    expect(unwrap(again)).toEqual({ path: incidentClaimPath({ channelId: "C0LIVE", home }), state: "held" });
  });

  it("names a hand-made doc squatting this channel's slug, and takes no claim", async () => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handovers, { recursive: true });
    // Hand-made, and its prose even mentions "channel C0LIVE," — still not the row this sweep writes.
    writeFileSync(join(paths.handovers, "incident-c0live.md"), "Follow up with channel C0LIVE, about retention\n");

    const report = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "a row doc already at incident-c0live names a different channel, so this channel's row cannot be written " +
        "under its id; move that doc aside and the next sweep registers it",
    ]);
    expect(existsSync(incidentClaimPath({ channelId: "C0LIVE", home }))).toBe(false);
  });

  it("refuses rather than registering when a row doc for the channel will not read", async () => {
    const paths = stateHomePaths({ home });
    // A directory where the archived doc should be: it lists under the channel's id and will not read as a file.
    const blocked = join(paths.handoverArchive, `${incidentRowSlug({ channel: LIVE })}.md`);
    mkdirSync(blocked, { recursive: true });

    const report = await detectLiveIncidents({ channels: [LIVE], deps: deps(), home, nowMs: NOW_MS });

    expect(report.registered).toEqual([]);
    expect(report.skipped[0]!.why).toContain(
      `the board's row docs would not read, so a second row cannot be ruled out: ${blocked} would not read: `,
    );
    expect(readdirSync(paths.handovers).filter((name) => name.endsWith(".md"))).toEqual([]);
  });
});
