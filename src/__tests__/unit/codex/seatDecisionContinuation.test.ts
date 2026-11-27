/**
 * {@link decideContinuingCodexSeat}: a spawn continuing an app session keeps the `$CODEX_HOME` the app's recovery
 * journal recorded for it whenever that plan may still be spent — even when the ranker would route elsewhere — and
 * otherwise routes a FRESH session, carrying why. On main the spawn routed afresh every time, so a resume landed on
 * whichever plan ranked first and the app refused it for naming a different login.
 *
 * Every case reads a real throwaway register of two Codex rows whose live reads are both unreadable, so the ranker
 * falls to register order and prefers `codex-one`; the session was recorded on `codex-two`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recordCodexSeatExhaustion } from "../../../cli/commands/cmux/codexQuotaSeat.js";
import { decideCodexSeat, decideContinuingCodexSeat } from "../../../codex/seatDecision.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort, memoryCodexFleetCapStore } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-11-06T00:00:00.000Z";
const CAUGHT_AT = "2026-11-05T23:30:00.000Z";

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A sign-in port that files nothing anywhere. */
const SIGN_INS: CodexSignInPort = {
  read: () => Promise.resolve(ok([])),
  record: () => Promise.resolve(ok([])),
};

/** A state home holding a two-row Codex register, `codex-two` paused when asked, and both stores' directories. */
function fleet({ pausedReason }: { pausedReason: string | undefined }): {
  home: string;
  one: string;
  two: string;
} {
  const home = temp({ prefix: "seat-continue-" });
  const one = temp({ prefix: "seat-continue-one-" });
  const two = temp({ prefix: "seat-continue-two-" });
  const paused = pausedReason === undefined ? {} : { paused: { reason: pausedReason, sinceIso: CAUGHT_AT } };
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      rows: [
        { alias: "codex-one", provider: "codex", storeDir: one },
        { alias: "codex-two", provider: "codex", storeDir: two, ...paused },
      ],
      version: 1,
    }),
    "utf8",
  );
  return { home, one, two };
}

/** The shared inputs every decision here reads its fleet through. */
function ports(): Pick<Parameters<typeof decideCodexSeat>[0], "fleetCap" | "port" | "readLive" | "signInPort"> {
  return {
    fleetCap: memoryCodexFleetCapPort({ store: memoryCodexFleetCapStore() }),
    port: memoryPlanRegisterPort(),
    readLive: liveReaderFrom(),
    signInPort: SIGN_INS,
  };
}

describe("decideContinuingCodexSeat", () => {
  it("resumes on the recorded home even though the ranker routes a new seat to the other plan", async () => {
    const { home, two } = fleet({ pausedReason: undefined });
    const fresh = await decideCodexSeat({
      allowRefusing: false,
      home,
      nowIso: NOW,
      requestedAlias: undefined,
      ...ports(),
    });
    expect(unwrap(fresh).destination.alias).toBe("codex-one");
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: two, sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: undefined,
      ...ports(),
    });
    expect(unwrap(decided)).toEqual({
      kind: "resume",
      route: {
        choice: {
          alias: "codex-two",
          basis: "resumed",
          kind: "named",
          alternative: "a resume stays on its recorded plan; open a fresh session to route again",
          readings: [
            {
              alias: "codex-two",
              reading: "the plan its session was opened on, admitted by the seat preflight",
              state: "chosen",
            },
          ],
          reason: "the session resumes on the plan it was opened on, since its transcript lives under that home",
          vendor: "codex",
        },
        destination: { alias: "codex-two", codexHome: two },
        why: "app session 0b5e resumes on the plan it was opened on",
      },
    });
    // The home is a path, so it rides the destination and never the recorded choice.
    expect(JSON.stringify(unwrap(decided).route.choice)).not.toContain(two);
  });

  it("resumes when --plan names the recorded plan itself", async () => {
    const { home, two } = fleet({ pausedReason: undefined });
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: two, sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: "codex-two",
      ...ports(),
    });
    expect(unwrap(decided).kind).toBe("resume");
  });

  it("refuses a --plan naming another plan than the admissible recorded one, rather than ignoring it", async () => {
    const { home, two } = fleet({ pausedReason: undefined });
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: two, sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: "codex-one",
      ...ports(),
    });
    const refusal = unwrapErr(decided);
    expect(refusal.code).toBe("SEAT_REFUSED");
    expect(refusal.message).toBe(
      `refusing — --plan codex-one conflicts with app session 0b5e, which opened on codex-two (CODEX_HOME=${two}) ` +
        "and resumes only there — drop --plan, or name codex-two",
    );
  });

  it("opens fresh on the routed plan, naming why, when no registered plan carries the recorded home", async () => {
    const { home, one } = fleet({ pausedReason: undefined });
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: "/home/acme/.codex-retired", sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: undefined,
      ...ports(),
    });
    const fresh = unwrap(decided);
    expect(fresh.kind).toBe("fresh");
    expect(fresh).toHaveProperty("reason", "no registered Codex plan carries that home any more");
    expect(fresh.route.destination).toEqual({ alias: "codex-one", codexHome: one });
  });

  it("opens fresh, naming the owner's pause, when the recorded plan is paused", async () => {
    const { home, one, two } = fleet({ pausedReason: "card expired" });
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: two, sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: undefined,
      ...ports(),
    });
    const fresh = unwrap(decided);
    expect(fresh).toHaveProperty("reason", "codex-two is paused: card expired");
    expect(fresh.route.destination).toEqual({ alias: "codex-one", codexHome: one });
  });

  it("opens fresh when the recorded plan is capped, and resumes on it under --force", async () => {
    const { home, one, two } = fleet({ pausedReason: undefined });
    recordCodexSeatExhaustion({
      destination: { alias: "codex-two", codexHome: two },
      home,
      kind: "credits-out",
      observedAtIso: CAUGHT_AT,
    });
    const capped = unwrap(
      await decideContinuingCodexSeat({
        allowRefusing: false,
        continuing: { codexHome: two, sessionId: "0b5e" },
        home,
        nowIso: NOW,
        requestedAlias: undefined,
        ...ports(),
      }),
    );
    expect(capped.kind).toBe("fresh");
    expect(capped).toHaveProperty("reason", expect.stringContaining("credits"));
    expect(capped.route.destination).toEqual({ alias: "codex-one", codexHome: one });
    const forced = unwrap(
      await decideContinuingCodexSeat({
        allowRefusing: true,
        continuing: { codexHome: two, sessionId: "0b5e" },
        home,
        nowIso: NOW,
        requestedAlias: undefined,
        ...ports(),
      }),
    );
    expect(forced.kind).toBe("resume");
    expect(forced.route.destination.alias).toBe("codex-two");
  });

  it("opens fresh when nothing is signed into the recorded plan's store", async () => {
    const { home, one, two } = fleet({ pausedReason: undefined });
    const decided = await decideContinuingCodexSeat({
      allowRefusing: false,
      continuing: { codexHome: two, sessionId: "0b5e" },
      home,
      nowIso: NOW,
      requestedAlias: undefined,
      ...ports(),
      readLive: liveReaderFrom({ byHome: { [two]: { codexHome: two, kind: "signed-out", readAtIso: NOW } } }),
    });
    const fresh = unwrap(decided);
    expect(fresh).toHaveProperty("reason", "codex-two cannot be spent: nothing is signed in there");
    expect(fresh.route.destination).toEqual({ alias: "codex-one", codexHome: one });
  });
});
