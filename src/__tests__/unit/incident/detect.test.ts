import { describe, expect, it } from "vitest";

import type { IncidentChannel } from "../../../incident/channel.js";
import { detectLiveIncidents, incidentChannelsOf, liveCandidates } from "../../../incident/detect.js";
import { IncidentClaimErrors, IncidentLedgerErrors } from "../../../incident/errors.js";
import {
  type IncidentDetectDeps,
  type IncidentReadProbe,
  type IncidentRegistration,
  type IncidentRowDoc,
  registrationOutcome,
} from "../../../incident/register.js";
import type { SeenRow } from "../../../incident/seen.js";
import { err, ok } from "../../../lib/result.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const NOW_MS = Date.parse("2026-10-04T05:00:00.000Z");
const NOW_S = NOW_MS / 1000;

const LIVE: IncidentChannel = {
  createdEpochSeconds: NOW_S - 3600,
  id: "C0LIVE",
  name: "inc-2026-10-04-checkout-down",
  topic: "INC-80",
};
const PAST: IncidentChannel = {
  createdEpochSeconds: NOW_S - 11 * 86_400,
  id: "C0PAST",
  name: "inc-2026-09-23-payment-checkout-regression",
};
const DRILL: IncidentChannel = { createdEpochSeconds: NOW_S - 60, id: "C0DRILL", name: "inc-2026-10-04-test-alerts" };
const SEEN: IncidentChannel = { createdEpochSeconds: NOW_S - 60, id: "C0SEEN", name: "inc-2026-10-04-other" };
const GENERAL: IncidentChannel = { createdEpochSeconds: NOW_S - 60, id: "C0GEN", name: "general" };
const ARCHIVED: IncidentChannel = {
  createdEpochSeconds: NOW_S - 60,
  id: "C0ARCH",
  isArchived: true,
  name: "inc-2026-10-04-done",
};
const UNDATED: IncidentChannel = { id: "C0NODATE", name: "inc-2026-10-04-undated" };

const READABLE: IncidentReadProbe = { principal: "user", readable: true, workspaceUrl: "https://acme.slack.com/" };
const LIVE_LINK = "https://acme.slack.com/archives/C0LIVE";
/** The row an earlier sweep wrote for C0LIVE, when the channel carried another name. */
const EARLIER_ROW: IncidentRowDoc = {
  slug: "incident-c0live",
  text: `Investigate the live incident #inc-2026-10-04-checkout-slow, channel C0LIVE, ${LIVE_LINK}, unasked, by the incident skill …`,
};

/** Fake deps that record every effect, with the answers each case needs. */
function fakeDeps({
  claimState = "claimed",
  probe = READABLE,
  registration = { code: 0, created: true },
  releasable = true,
  rowDocs = [],
  seenIds = [],
}: {
  claimState?: "claimed" | "held";
  releasable?: boolean;
  probe?: IncidentReadProbe;
  registration?: IncidentRegistration;
  rowDocs?: readonly IncidentRowDoc[];
  seenIds?: readonly string[];
}): { deps: IncidentDetectDeps; argvs: (readonly string[])[]; recorded: SeenRow[]; released: string[] } {
  const argvs: (readonly string[])[] = [];
  const recorded: SeenRow[] = [];
  const released: string[] = [];
  const deps: IncidentDetectDeps = {
    checkout: () => ok("/repo/main"),
    claim: ({ channelId }) => ok({ path: `/home/incidents/claims/${channelId}`, state: claimState }),
    claimed: () => ok(new Set()),
    organisation: async () => ok(ACME_ORGANISATION),
    probe: async () => probe,
    record: ({ row }) => {
      recorded.push(row);
      return ok("/home/incidents/seen.jsonl");
    },
    register: async ({ argv }) => {
      argvs.push(argv);
      return registration;
    },
    reclaim: () => ok(false),
    release: ({ path }) => {
      released.push(path);
      return ok(releasable);
    },
    rowDocs: () => ok(rowDocs),
    seen: () => ok(new Set(seenIds)),
  };
  return { argvs, deps, recorded, released };
}

describe("liveCandidates", () => {
  it("admits the live incident, reports the drill and the unjudgeable, and is silent on everything else", () => {
    const { candidates, skipped } = liveCandidates({
      channels: [LIVE, PAST, DRILL, SEEN, GENERAL, ARCHIVED, UNDATED],
      claimed: new Set(),
      nowEpochSeconds: NOW_S,
      seen: new Set(["C0SEEN"]),
    });

    expect(candidates.map((channel) => channel.id)).toEqual(["C0LIVE"]);
    expect(skipped).toEqual([
      { channelId: "C0DRILL", name: "inc-2026-10-04-test-alerts", why: 'drill: names itself "test"' },
      { channelId: "C0ARCH", name: "inc-2026-10-04-done", why: "archived" },
      { channelId: "C0NODATE", name: "inc-2026-10-04-undated", why: "no created time" },
    ]);
  });

  it("keeps a claimed channel a candidate past the window until the ledger records its row", () => {
    const pastWindow: IncidentChannel = { ...LIVE, createdEpochSeconds: NOW_S - 49 * 3600, isArchived: true };

    const owed = liveCandidates({
      channels: [pastWindow],
      claimed: new Set(["C0LIVE"]),
      nowEpochSeconds: NOW_S,
      seen: new Set(),
    });
    const recorded = liveCandidates({
      channels: [pastWindow],
      claimed: new Set(["C0LIVE"]),
      nowEpochSeconds: NOW_S,
      seen: new Set(["C0LIVE"]),
    });

    expect(owed).toEqual({ candidates: [pastWindow], skipped: [] });
    expect(recorded).toEqual({ candidates: [], skipped: [] });
  });
});

describe("registrationOutcome", () => {
  const named = "… channel C0LIVE, https://acme.slack.com/archives/C0LIVE, unasked, …";

  it("reads THIS call's receipt first", () => {
    expect(
      registrationOutcome({ channelId: "C0LIVE", existing: named, registration: { code: 0, created: true } }),
    ).toBe("created");
    expect(
      registrationOutcome({ channelId: "C0LIVE", existing: named, registration: { code: 1, created: true } }),
    ).toBe("created-incomplete");
  });

  it("calls a row another call created already-existed only when its ask names this channel", () => {
    expect(
      registrationOutcome({ channelId: "C0LIVE", existing: named, registration: { code: 1, created: false } }),
    ).toBe("already-existed");
    expect(
      registrationOutcome({ channelId: "C0LIVE2", existing: named, registration: { code: 1, created: false } }),
    ).toBeUndefined();
    expect(
      registrationOutcome({ channelId: "C0LIVE", existing: undefined, registration: { code: 1, created: false } }),
    ).toBeUndefined();
  });
});

describe("detectLiveIncidents", () => {
  it("registers the live incident once, with a permalink on the probed workspace, and records it", async () => {
    const { deps, argvs, recorded } = fakeDeps({});

    const report = await detectLiveIncidents({ channels: [LIVE, PAST, GENERAL], deps, home: "/home", nowMs: NOW_MS });

    expect(report).toEqual({
      registered: [
        {
          channelId: "C0LIVE",
          name: "inc-2026-10-04-checkout-down",
          outcome: "created",
          slug: "incident-c0live",
        },
      ],
      skipped: [],
    });
    expect(argvs.length).toBe(1);
    expect(argvs[0]!.join(" ")).toContain("channel C0LIVE, https://acme.slack.com/archives/C0LIVE,");
    expect(recorded).toEqual([
      {
        atIso: "2026-10-04T05:00:00.000Z",
        channelId: "C0LIVE",
        outcome: "created",
        slug: "incident-c0live",
      },
    ]);
  });

  it("skips a channel the read token cannot open, giving back the claim it took first", async () => {
    const { deps, argvs, recorded, released } = fakeDeps({
      probe: { readable: false, why: "not readable by the user token: channel_not_found" },
    });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped).toEqual([
      {
        channelId: "C0LIVE",
        name: "inc-2026-10-04-checkout-down",
        why: "not readable by the user token: channel_not_found",
      },
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
    expect(released).toEqual(["/home/incidents/claims/C0LIVE"]);
  });

  it("says the claim stays when it was held too long to give back safely", async () => {
    const { deps, argvs } = fakeDeps({
      probe: { readable: false, why: "not readable by the user token: channel_not_found" },
      releasable: false,
    });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((skip) => skip.why)).toEqual([
      "not readable by the user token: channel_not_found; the claim at /home/incidents/claims/C0LIVE stays, since " +
        "this sweep held it long enough that another may have taken it over, and a sweep retries the channel once " +
        "it is 30 minutes old",
    ]);
    expect(argvs).toEqual([]);
  });

  it("writes no row when the probe names a workspace that is not a Slack link, since its ask could not be recognised again", async () => {
    const { deps, argvs, recorded, released } = fakeDeps({
      probe: { principal: "user", readable: true, workspaceUrl: "https://example.invalid/" },
    });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped).toEqual([
      {
        channelId: "C0LIVE",
        name: "inc-2026-10-04-checkout-down",
        why:
          "the probe named the workspace https://example.invalid/, which is not a Slack workspace link, so the row's " +
          "ask could not be recognised again",
      },
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
    expect(released).toEqual(["/home/incidents/claims/C0LIVE"]);
  });

  it("keeps a claim taken over from a dead sweep when the probe fails, so the channel stays a candidate", async () => {
    const { deps, argvs, released } = fakeDeps({
      claimState: "held",
      probe: { readable: false, why: "not readable by the user token: ratelimited" },
    });
    const takenOver: IncidentDetectDeps = { ...deps, reclaim: () => ok(true) };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: takenOver, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "not readable by the user token: ratelimited; the claim at /home/incidents/claims/C0LIVE was taken over from a " +
        "dead sweep and stays, so the channel stays a candidate and a sweep retries it once the claim is 30 minutes old",
    ]);
    expect(argvs).toEqual([]);
    expect(released).toEqual([]);
  });

  it("keeps a claim taken over from a dead sweep when register refuses", async () => {
    const { deps, released } = fakeDeps({ claimState: "held", registration: { code: 2, created: false } });
    const takenOver: IncidentDetectDeps = { ...deps, reclaim: () => ok(true) };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: takenOver, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "register refused (exit 2); its reason is on stderr; the claim at /home/incidents/claims/C0LIVE was taken over " +
        "from a dead sweep and stays, so the channel stays a candidate and a sweep retries it once the claim is 30 " +
        "minutes old",
    ]);
    expect(released).toEqual([]);
  });

  it("never remembers a refused registration and gives its claim back, so the next sweep tries again", async () => {
    const { deps, recorded, released } = fakeDeps({ registration: { code: 2, created: false } });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.registered).toEqual([]);
    expect(report.skipped[0]!.why).toBe("register refused (exit 2); its reason is on stderr");
    expect(recorded).toEqual([]);
    expect(released).toEqual(["/home/incidents/claims/C0LIVE"]);
  });

  it("keeps its claim when a refused registration cannot be confirmed rowless because the docs would not read", async () => {
    const { deps, argvs, recorded, released } = fakeDeps({ registration: { code: 1, created: false } });
    // The pre-check reads; the post-check, after the register call, does not.
    const flaky: IncidentDetectDeps = {
      ...deps,
      rowDocs: () => (argvs.length > 0 ? err(["/home/handovers/incident-c0live.md would not read: EIO"]) : ok([])),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: flaky, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "register reported no row (exit 1) and the row docs would not read to confirm, so the claim stays at " +
        "/home/incidents/claims/C0LIVE: /home/handovers/incident-c0live.md would not read: EIO",
    ]);
    expect(released).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses, registering nothing, when another sweep holds the claim and no row doc names the channel", async () => {
    const { deps, argvs, recorded } = fakeDeps({ claimState: "held" });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "/home/incidents/claims/C0LIVE claims this channel and no row doc names it yet — a sweep mid-registration, " +
        "or one that died after claiming; a sweep takes it over once it is 30 minutes old",
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("takes over a dead sweep's stale claim when no row doc names the channel, and registers", async () => {
    const { deps, argvs, recorded } = fakeDeps({});
    const states: ("claimed" | "held")[] = ["held", "claimed"];
    const reclaimed: string[] = [];
    const stale: IncidentDetectDeps = {
      ...deps,
      claim: ({ channelId }) => ok({ path: `/home/incidents/claims/${channelId}`, state: states.shift()! }),
      reclaim: ({ path }) => {
        reclaimed.push(path);
        return ok(true);
      },
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: stale, home: "/home", nowMs: NOW_MS });

    expect(reclaimed).toEqual(["/home/incidents/claims/C0LIVE"]);
    expect(argvs.length).toBe(1);
    expect(report.registered.map((one) => one.outcome)).toEqual(["created"]);
    expect(recorded.map((row) => row.slug)).toEqual(["incident-c0live"]);
  });

  it("refuses, registering nothing, when a stale claim would not be restamped", async () => {
    const { deps, argvs } = fakeDeps({ claimState: "held" });
    const stuck: IncidentDetectDeps = {
      ...deps,
      reclaim: ({ path }) => err(IncidentClaimErrors.io({ action: "restamp", cause: "EACCES", path })),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: stuck, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "the channel's claim could not be taken, so nothing was registered: " +
        "/home/incidents/claims/C0LIVE would not restamp: EACCES",
    ]);
    expect(argvs).toEqual([]);
  });

  it("records a create race it lost as already-existed", async () => {
    const { deps, argvs, recorded } = fakeDeps({ registration: { code: 1, created: false } });
    // The other sweep's row appears between this sweep's pre-check and its own registration.
    const raced: IncidentDetectDeps = {
      ...deps,
      rowDocs: () => ok(argvs.length > 0 ? [EARLIER_ROW] : []),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: raced, home: "/home", nowMs: NOW_MS });

    expect(argvs.length).toBe(1);
    expect(report.registered.map((one) => one.outcome)).toEqual(["already-existed"]);
    expect(recorded.map((row) => row.outcome)).toEqual(["already-existed"]);
  });

  it("records a row already on the board — written under the channel's old name, archived included — without probing or registering", async () => {
    const { deps, argvs, recorded } = fakeDeps({ rowDocs: [EARLIER_ROW] });
    const probes: string[] = [];
    const watched: IncidentDetectDeps = {
      ...deps,
      probe: async ({ channelId }) => {
        probes.push(channelId);
        return READABLE;
      },
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: watched, home: "/home", nowMs: NOW_MS });

    expect(report.registered.map((one) => one.outcome)).toEqual(["already-existed"]);
    expect(recorded.map((row) => row.slug)).toEqual(["incident-c0live"]);
    expect(probes).toEqual([]);
    expect(argvs).toEqual([]);
  });

  it("skips, registering nothing, when the board's row docs would not read", async () => {
    const { deps, argvs, recorded } = fakeDeps({});
    const unreadable: IncidentDetectDeps = {
      ...deps,
      rowDocs: () => err(["/home/handovers/archive/incident-c0live.md would not read: EACCES"]),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: unreadable, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "the board's row docs would not read, so a second row cannot be ruled out: " +
        "/home/handovers/archive/incident-c0live.md would not read: EACCES",
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses by name, registering nothing, when a doc under this id's slug names a different channel", async () => {
    const { deps, argvs, recorded } = fakeDeps({
      rowDocs: [
        { slug: "incident-c0live", text: "Investigate … channel C0OTHER, https://acme.slack.com/archives/C0OTHER …" },
      ],
    });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "a row doc already at incident-c0live names a different channel, so this channel's row cannot be written " +
        "under its id; move that doc aside and the next sweep registers it",
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses by name a doc naming a different channel even beside the channel's own archived row", async () => {
    const { deps, argvs, recorded } = fakeDeps({
      rowDocs: [EARLIER_ROW, { slug: "incident-c0live", text: "Follow up on retention, nothing to do with C0LIVE" }],
    });

    const report = await detectLiveIncidents({ channels: [LIVE], deps, home: "/home", nowMs: NOW_MS });

    expect(report.skipped.map((one) => one.why)).toEqual([
      "a row doc at incident-c0live beside this channel's own row names a different channel; move that doc aside " +
        "and the next sweep records the row",
    ]);
    expect(argvs).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("carries a failed ledger append on the registered row rather than dropping it", async () => {
    const { deps } = fakeDeps({});
    const failing: IncidentDetectDeps = {
      ...deps,
      record: () => err(IncidentLedgerErrors.unreadable({ cause: "EACCES", path: "/home/incidents/seen.jsonl" })),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: failing, home: "/home", nowMs: NOW_MS });

    expect(report.registered[0]!.ledger).toBe("incidents seen ledger /home/incidents/seen.jsonl: EACCES");
  });

  it("registers nothing when the ledger will not read", async () => {
    const { deps, argvs } = fakeDeps({});
    const corrupt: IncidentDetectDeps = {
      ...deps,
      seen: () => err(IncidentLedgerErrors.corrupt({ lineNumber: 3, why: "it is not JSON" })),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: corrupt, home: "/home", nowMs: NOW_MS });

    expect(report.registered).toEqual([]);
    expect(report.refused).toContain("line 3: it is not JSON");
    expect(argvs).toEqual([]);
  });

  it("registers nothing when the claims will not list", async () => {
    const { deps, argvs } = fakeDeps({});
    const unlisted: IncidentDetectDeps = {
      ...deps,
      claimed: () => err(IncidentClaimErrors.io({ action: "list", cause: "EACCES", path: "/home/incidents/claims" })),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: unlisted, home: "/home", nowMs: NOW_MS });

    expect(report).toEqual({ refused: "/home/incidents/claims would not list: EACCES", registered: [], skipped: [] });
    expect(argvs).toEqual([]);
  });

  it("names every candidate unseated when there is no checkout, registering nothing", async () => {
    const { deps, argvs } = fakeDeps({});
    const homeless: IncidentDetectDeps = { ...deps, checkout: () => err(["no declared checkout"]) };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: homeless, home: "/home", nowMs: NOW_MS });

    expect(report.skipped).toEqual([
      {
        channelId: "C0LIVE",
        name: "inc-2026-10-04-checkout-down",
        why: "no checkout to seat the investigation in: no declared checkout",
      },
    ]);
    expect(argvs).toEqual([]);
  });

  it("names every candidate unplaced when no organisation is written, registering nothing", async () => {
    const { deps, argvs, recorded } = fakeDeps({});
    const unwritten: IncidentDetectDeps = {
      ...deps,
      organisation: async () => err(["no organisation is configured in the store"]),
    };

    const report = await detectLiveIncidents({ channels: [LIVE], deps: unwritten, home: "/home", nowMs: NOW_MS });

    expect(report.skipped).toEqual([
      {
        channelId: "C0LIVE",
        name: "inc-2026-10-04-checkout-down",
        why: "no organisation to place the row by: no organisation is configured in the store",
      },
    ]);
    expect([argvs, recorded]).toEqual([[], []]);
  });
});

describe("incidentChannelsOf", () => {
  it("keeps named refs with the fields detection reads, and drops an unnamed one", () => {
    expect(
      incidentChannelsOf({
        refs: [
          {
            createdEpochSeconds: 1,
            creator: "U1",
            id: "C1",
            isMember: false,
            isPrivate: false,
            name: "inc-x",
            topic: "INC-1",
          },
          { id: "D1", isIm: true },
        ],
      }),
    ).toEqual([
      {
        createdEpochSeconds: 1,
        creator: "U1",
        id: "C1",
        isMember: false,
        isPrivate: false,
        name: "inc-x",
        topic: "INC-1",
      },
    ]);
  });
});
