/**
 * `slopweaver turn reach` and the answer refusal that reads its receipts — the owner's ask that anything useful be
 * reachable before an answer. The pure planner, then the whole verb over plain fake
 * seams (a visit, a block, a receipt write), then a receipt written for real and read back by the refusal.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BlockInputs } from "../../../../../cli/commands/turn/blockInputs.js";
import { type ReachDeps, reachTurn } from "../../../../../cli/commands/turn/reach.js";
import { planReach, reachOrigins, uncheckedEvidenceOrigins } from "../../../../../cli/commands/turn/reachCore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { RecheckObservation } from "../../../../../hand/recheck.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import { appendProgressLogEvent, readProgressLog, readReachReceipts } from "../../../../../live/turn/progressLog.js";
import { decodeReachRecord } from "../../../../../live/turn/progressReach.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const ADMIN = "https://admin.google.com";
const TRELICA = "https://acme.trelica.app";
const ASK = { channel: "C1", messageTs: "1.1", threadTs: "1.1" };
const RECEIPT_FOR_ASK = { askIdentity: ASK, kind: "reach" as const, tsIso: "2026-09-29T04:20:00.000Z" };

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "who is in the admin group?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/** An answer whose evidence lines carry the given URLs, one per bucket named. */
function answer({
  read = [],
  consultedEmpty = [],
  premise = [],
}: {
  read?: readonly string[];
  consultedEmpty?: readonly string[];
  premise?: readonly string[];
}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: consultedEmpty.map((url) => ({ label: "empty page", url })),
        couldNotSee: { blindSpots: [], reason: "nothing else to check" },
        premiseChecks: premise.map((url) => ({
          checkedAtIso: "2026-09-29T04:20:00.000Z",
          finding: "exists" as const,
          how: "opened it",
          subject: "the group",
          url,
        })),
        read: read.map((url) => ({ label: "a page", url })),
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
      reason: "read the console",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "Three people are in the admin group.",
    measurements: [],
  };
}

describe("reachOrigins", () => {
  it("reduces the pages to unique origins in the order given", () => {
    expect(unwrap(reachOrigins({ urls: [`${ADMIN}/ac/users`, `${TRELICA}/apps`, `${ADMIN}/ac/groups?q=1`] }))).toEqual([
      ADMIN,
      TRELICA,
    ]);
  });

  it("refuses an empty list, and names every value that is not an https page", () => {
    expect(unwrapErr(reachOrigins({ urls: [] }))).toEqual([
      "--url is required — the page the answer will lean on, once per origin",
    ]);
    expect(unwrapErr(reachOrigins({ urls: ["http://admin.google.com", "admin"] }))).toEqual([
      '--url must be an https:// page, got "http://admin.google.com"',
      '--url must be an https:// page, got "admin"',
    ]);
  });
});

describe("planReach", () => {
  const met: RecheckObservation = { kind: "met", observed: "signed in" };
  const unmet: RecheckObservation = { kind: "unmet", observed: "sent to accounts.google.com" };

  it("is reachable only when every origin was read signed in", () => {
    expect(
      planReach({
        observations: [
          { origin: ADMIN, outcome: met, platform: "google-admin" },
          { origin: TRELICA, outcome: met, platform: "trelica" },
        ],
      }),
    ).toEqual({ kind: "reachable", origins: [ADMIN, TRELICA] });
  });

  it("blocks on the FIRST signed-out origin, one step at a time", () => {
    expect(
      planReach({
        observations: [
          { origin: TRELICA, outcome: met, platform: "trelica" },
          { origin: ADMIN, outcome: unmet, platform: "google-admin" },
          { origin: "https://go.xero.com", outcome: unmet, platform: "xero" },
        ],
      }),
    ).toEqual({ kind: "block", observed: "sent to accounts.google.com", origin: ADMIN });
  });

  it("never calls an unprobed origin reachable because another passed, and never calls an unread one signed out", () => {
    expect(
      planReach({
        observations: [
          { origin: ADMIN, outcome: unmet, platform: "google-admin" },
          { origin: "https://example.com", outcome: undefined, platform: undefined },
        ],
      }),
    ).toEqual({ kind: "unsupported", origins: ["https://example.com"] });
    expect(
      planReach({
        observations: [
          { origin: ADMIN, outcome: unmet, platform: "google-admin" },
          { origin: TRELICA, outcome: { kind: "unread", why: "the relay lease was held" }, platform: "trelica" },
        ],
      }),
    ).toEqual({ kind: "unread", origin: TRELICA, why: "the relay lease was held" });
  });
});

describe("decodeReachRecord", () => {
  const tsIso = "2026-09-29T04:20:00.000Z";

  it("decodes a receipt naming its ask and every origin", () => {
    expect(decodeReachRecord({ record: { askIdentity: ASK, origins: [ADMIN] }, tsIso })).toEqual({
      askIdentity: ASK,
      kind: "reach",
      origins: [ADMIN],
      tsIso,
    });
  });

  it("refuses a receipt with no ask, no origin, or an origin that is not a string", () => {
    expect(
      [{ origins: [ADMIN] }, { askIdentity: ASK, origins: [] }, { askIdentity: ASK, origins: [ADMIN, 7] }].map(
        (record) => decodeReachRecord({ record, tsIso }),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});

describe("uncheckedEvidenceOrigins", () => {
  it("names a probed origin the evidence declares a read of, in every bucket, once each", () => {
    expect(
      uncheckedEvidenceOrigins({
        answer: answer({
          consultedEmpty: [`${TRELICA}/apps`],
          premise: [`${ADMIN}/ac/groups`],
          read: [`${ADMIN}/ac/users`],
        }),
        reaches: [],
      }),
    ).toEqual([ADMIN, TRELICA]);
  });

  it("lets through an origin a receipt names, and one no probe reads", () => {
    expect(
      uncheckedEvidenceOrigins({
        answer: answer({ read: [`${ADMIN}/ac/users`, "https://github.com/lachiejames/slopweaver/pull/1"] }),
        reaches: [{ ...RECEIPT_FOR_ASK, origins: [ADMIN] }],
      }),
    ).toEqual([]);
  });
});

describe("reachTurn, over plain fake seams", () => {
  let home: string;
  let briefPath: string;
  const calls: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-turn-reach-"));
    calls.length = 0;
    writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify(["U_ASKER"]), "utf8");
    briefPath = join(home, "brief.json");
    writeFileSync(
      briefPath,
      JSON.stringify(
        buildTurnRoutingBrief({
          ...ASK,
          question: "who is in the admin group?",
          routingInput: ROUTING_INPUT,
          started: { turnId: "turn-1", workingTs: "1.2" },
          surface: "channel",
          unavailableCapabilities: [],
          userId: "U_ASKER",
        }),
      ),
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Seams that record every call, with each origin's visit answered from the table. */
  function deps({ visits }: { visits: Readonly<Record<string, RecheckObservation>> }): ReachDeps {
    return {
      block: async ({ inputs }: { inputs: BlockInputs }) => {
        calls.push(`block ${inputs.need} ${String(inputs.signInOrigin)} ${inputs.what}`);
        return EXIT_OK;
      },
      browserSession: async ({ origin }) => {
        calls.push(`visit ${origin}`);
        return visits[origin]!;
      },
      record: ({ event }) => {
        calls.push(`record ${event.origins.join(",")}`);
      },
    };
  }

  /** The argv tail for this home's brief and the given pages. */
  function rest({ urls }: { urls: readonly string[] }): readonly string[] {
    return ["--brief", briefPath, "--home", home, ...urls.flatMap((url) => ["--url", url])];
  }

  it("writes a receipt naming every origin once each is signed in", async () => {
    const code = await reachTurn({
      deps: deps({
        visits: {
          [ADMIN]: { kind: "met", observed: "landed on /ac/home" },
          [TRELICA]: { kind: "met", observed: "ok" },
        },
      }),
      rest: rest({ urls: [`${ADMIN}/ac/users`, `${TRELICA}/apps`] }),
    });

    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual([`visit ${ADMIN}`, `visit ${TRELICA}`, `record ${ADMIN},${TRELICA}`]);
  });

  it("enters the sign-in block on a signed-out page, naming its host, and exits 3 rather than 0", async () => {
    const code = await reachTurn({
      deps: deps({ visits: { [ADMIN]: { kind: "unmet", observed: "sent to accounts.google.com" } } }),
      rest: rest({ urls: [`${ADMIN}/ac/users`] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(calls).toEqual([`visit ${ADMIN}`, `block sign-in ${ADMIN} log into admin.google.com in the work Chrome`]);
  });

  it("visits nothing it cannot judge, and writes no receipt and enters no block for it", async () => {
    const code = await reachTurn({ deps: deps({ visits: {} }), rest: rest({ urls: ["https://example.com/x"] }) });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(calls).toEqual([]);
  });

  it("exits 1 on a visit that could not read, never blocking the owner on it", async () => {
    const code = await reachTurn({
      deps: deps({ visits: { [ADMIN]: { kind: "unread", why: "no relay token" } } }),
      rest: rest({ urls: [`${ADMIN}/ac/users`] }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(calls).toEqual([`visit ${ADMIN}`]);
  });

  it("refuses a missing --url before reading the brief or touching a seam", async () => {
    expect(await reachTurn({ deps: deps({ visits: {} }), rest: ["--brief", "/nowhere.json"] })).toBe(EXIT_USAGE);
    expect(calls).toEqual([]);
  });

  it("writes no receipt on a dry run", async () => {
    const code = await reachTurn({
      deps: deps({ visits: { [ADMIN]: { kind: "met", observed: "ok" } } }),
      rest: [...rest({ urls: [ADMIN] }), "--dry-run"],
    });

    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual([`visit ${ADMIN}`]);
  });
});

describe("a receipt written to the progress log", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-reach-receipt-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("is read back by the answer refusal, and stays off the card's timeline", () => {
    const before = uncheckedEvidenceOrigins({
      answer: answer({ read: [`${ADMIN}/ac/users`] }),
      reaches: readReachReceipts({ askIdentity: ASK, home }),
    });
    appendProgressLogEvent({ askIdentity: ASK, event: { ...RECEIPT_FOR_ASK, origins: [ADMIN] }, home });

    expect(before).toEqual([ADMIN]);
    expect(
      uncheckedEvidenceOrigins({
        answer: answer({ read: [`${ADMIN}/ac/users`] }),
        reaches: readReachReceipts({ askIdentity: ASK, home }),
      }),
    ).toEqual([]);
    expect(readProgressLog({ askIdentity: ASK, home }).timeline).toEqual([]);
  });

  it("never lets one ask's receipt through for another ask whose log shares its file name", () => {
    const askA = { channel: "C-A", messageTs: "B", threadTs: "B" };
    const askB = { channel: "C", messageTs: "A-B", threadTs: "A-B" };
    const otherThread = { channel: "C-A", messageTs: "B", threadTs: "root-2" };
    appendProgressLogEvent({
      askIdentity: askA,
      event: { ...RECEIPT_FOR_ASK, askIdentity: askA, origins: [ADMIN] },
      home,
    });

    expect(readReachReceipts({ askIdentity: askA, home }).map((receipt) => receipt.origins)).toEqual([[ADMIN]]);
    expect(readReachReceipts({ askIdentity: askB, home })).toEqual([]);
    expect(readReachReceipts({ askIdentity: otherThread, home })).toEqual([]);
  });
});
