import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { grantedEnv, grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs, replyArgv } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — the high-stakes channel gate (--as bot)", () => {
  const HIGH_STAKES = ok({
    channels: [{ id: "C1", name: "#defects" }],
    fleetGap: undefined,
    fleetUserIds: ["U0OWNER"],
    listGap: undefined,
  });

  it("REFUSES a top-level update card to a high-stakes channel, before any live read or send", async () => {
    const rec = recorder();
    const reads: string[] = [];
    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: deps({
        fleetHistory: async ({ channel }) => {
          reads.push(channel);
          return { kind: "read", priors: [] };
        },
        highStakes: HIGH_STAKES,
        rec,
      }),
      verb: "post",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
    expect(reads).toEqual([]);
  });

  it("REFUSES a second fleet post there inside the day even with a live undefended grant, reading by id", async () => {
    const rec = recorder();
    const reads: string[] = [];
    const home = freshHome();
    const env = grantedEnv({ hatchIds: ["high-stakes-undefended"], home });
    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: {
        ...deps({
          fleetHistory: async ({ channel }) => {
            reads.push(channel);
            return { kind: "read", priors: [{ permalink: "https://x.slack.com/archives/C1/p1", ts: "1.000001" }] };
          },
          highStakes: HIGH_STAKES,
          rec,
        }),
        doorEnv: () => env,
      },
      verb: "post",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
    expect(reads).toEqual(["C1"]);
  });

  it("REFUSES a top-level card with only the retired undefended variable set, before any live read", async () => {
    const rec = recorder();
    const reads: string[] = [];
    const home = freshHome();
    const env = { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_HIGH_STAKES_UNDEFENDED: "1" };
    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: {
        ...deps({
          fleetHistory: async ({ channel }) => {
            reads.push(channel);
            return { kind: "read", priors: [] };
          },
          highStakes: HIGH_STAKES,
          rec,
        }),
        doorEnv: () => env,
      },
      verb: "post",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
    expect(reads).toEqual([]);
  });

  it.each([
    { claims: ["peek C1", "take C1"], code: EXIT_OK, extra: [], name: "a live send takes the claim", sends: 1 },
    { claims: ["peek C1"], code: EXIT_OK, extra: ["--dry-run"], name: "a dry run only looks at it", sends: 0 },
  ])("$name on a high-stakes channel", async ({ claims: expected, code: expectedCode, extra, sends }) => {
    const rec = recorder();
    const claims: string[] = [];
    const home = freshHome();
    const env = grantedEnv({ hatchIds: ["high-stakes-undefended"], home });
    const code = await runSlackWrite({
      argv: argv({ extra, home }),
      deps: {
        ...deps({ highStakes: HIGH_STAKES, rec }),
        channelClaim: ({ channel, take }) => {
          claims.push(`${take ? "take" : "peek"} ${channel}`);
          return take ? { claimId: "k1", kind: "held" } : { kind: "free" };
        },
        doorEnv: () => env,
      },
      verb: "post",
    });
    expect(code).toBe(expectedCode);
    expect(rec.sends.length).toBe(sends);
    expect(claims).toEqual(expected);
  });

  it("REFUSES a live card when another send holds the channel's claim, and sends nothing", async () => {
    const rec = recorder();
    const home = freshHome();
    const env = grantedEnv({ hatchIds: ["high-stakes-undefended"], home });
    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: {
        ...deps({ highStakes: HIGH_STAKES, rec }),
        channelClaim: ({ take }) =>
          take ? { claimedIso: "2026-09-28T20:00:00.000Z", kind: "taken" } : { kind: "free" },
        doorEnv: () => env,
      },
      verb: "post",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("lets a reply in a high-stakes channel's thread through untouched", async () => {
    const rec = recorder();
    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({ highStakes: HIGH_STAKES, rec }),
      verb: "reply",
    });
    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(1);
  });

  it("REFUSES every top-level post when the high-stakes list cannot be read, rather than reading it as none", async () => {
    const rec = recorder();
    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: deps({
        highStakes: err({
          code: "PROFILE_UNREADABLE",
          detail: "not valid JSON",
          message: "the profile at /p is there but cannot be trusted (not valid JSON)",
          path: "/p",
        }),
        rec,
      }),
      verb: "post",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });
});
