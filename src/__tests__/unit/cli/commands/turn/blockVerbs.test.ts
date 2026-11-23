/**
 * The pure halves of `turn block`, `turn unblock` and `turn blocked`: which flags they require, the exact
 * card frame a block writes, and the two projections a row is read through.
 */
import { describe, expect, it } from "vitest";
import { turnBlockPlan } from "../../../../../cli/commands/turn/block.js";
import { blockedRowJson, blockedRowLine } from "../../../../../cli/commands/turn/blockedList.js";
import { blockedNeedFrom, turnBlockInputs } from "../../../../../cli/commands/turn/blockInputs.js";
import { resumeCommandFor, turnUnblockInputs } from "../../../../../cli/commands/turn/unblock.js";
import type { BlockedAsk } from "../../../../../live/turn/blockedOnHuman.js";
import type { ProgressStageEvent } from "../../../../../live/turn/progressLog.js";

const BASE = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

const A_STAGE: ProgressStageEvent = {
  kind: "stage",
  text: "Waiting on the owner: sign in to Google Cloud locally",
  tsIso: "2026-09-07T00:20:00.000Z",
};

const A_ROW: BlockedAsk = {
  ...BASE,
  blocked: {
    ...BASE,
    kind: "blocked-on-human",
    need: "sign-in",
    stepText: A_STAGE.text,
    tsIso: "2026-09-07T00:20:00.000Z",
    what: "sign in to Google Cloud locally",
  },
  standing: "waiting",
};

describe("turn block's own arguments", () => {
  it("reads the four needs and refuses anything else rather than defaulting", () => {
    expect(blockedNeedFrom({ value: "sign-in" })).toBe("sign-in");
    expect(blockedNeedFrom({ value: "risky-approval" })).toBe("risky-approval");
    expect(blockedNeedFrom({ value: "ruling" })).toBe("ruling");
    expect(blockedNeedFrom({ value: "other" })).toBe("other");
    expect(blockedNeedFrom({ value: "vibes" })).toBeUndefined();
    expect(blockedNeedFrom({ value: undefined })).toBeUndefined();
  });

  it("names every missing flag at once", () => {
    expect(turnBlockInputs({ values: {} })).toEqual({
      kind: "invalid",
      problems: ["--need (sign-in, risky-approval, ruling, other) is required", "--what is required"],
    });
  });

  it("refuses a blank --what, which would put an empty sentence on the card", () => {
    expect(turnBlockInputs({ values: { need: "sign-in", what: "   " } })).toEqual({
      kind: "invalid",
      problems: ["--what is required"],
    });
  });

  it("accepts a complete invocation, trimming the sentence", () => {
    expect(turnBlockInputs({ values: { need: "sign-in", what: " sign in to Google Cloud " } })).toEqual({
      inputs: { need: "sign-in", what: "sign in to Google Cloud" },
      kind: "ready",
    });
  });

  it("keeps only the ORIGIN of a --sign-in-url, the page the sign-in card opens", () => {
    expect(
      turnBlockInputs({
        values: { need: "sign-in", "sign-in-url": "https://admin.google.com/ac/home?hl=en", what: "log into Admin" },
      }),
    ).toEqual({
      inputs: { need: "sign-in", signInOrigin: "https://admin.google.com", what: "log into Admin" },
      kind: "ready",
    });
  });

  it("refuses a --sign-in-url beside any other need, and one that is not an https page", () => {
    expect(
      turnBlockInputs({ values: { need: "other", "sign-in-url": "https://admin.google.com", what: "approve it" } }),
    ).toEqual({ kind: "invalid", problems: ["--sign-in-url is only for --need sign-in"] });
    expect(
      turnBlockInputs({ values: { need: "sign-in", "sign-in-url": "http://admin.google.com", what: "log in" } }),
    ).toEqual({
      kind: "invalid",
      problems: ['--sign-in-url must be an https:// page, got "http://admin.google.com"'],
    });
  });

  it("puts the sign-in origin on the blocked row's JSON, which a sign-in with no page leaves off", () => {
    const withPage: BlockedAsk = { ...A_ROW, blocked: { ...A_ROW.blocked, signInOrigin: "https://admin.google.com" } };
    expect(blockedRowJson({ row: withPage })["signInOrigin"]).toBe("https://admin.google.com");
    expect(Object.keys(blockedRowJson({ row: A_ROW }))).not.toContain("signInOrigin");
  });

  it("puts the hourglass on the live step, with what the owner has to do under it and no `now:` line", () => {
    const plan = turnBlockPlan({
      askIdentity: { channel: "C1" },
      need: "sign-in",
      question: "can you deploy the p99 monitor?",
      started: { workingTs: "1785000000.000150" },
      timeline: [A_STAGE],
    });
    expect(plan.posted).toEqual({ channel: "C1", ts: "1785000000.000150" });
    expect(plan.steps.map((step) => step.state)).toEqual(["done", "blocked"]);
    expect(plan.steps[1]!.children).toEqual(["waiting on the owner to sign in — picking straight back up once it is"]);
  });
});

describe("turn unblock's own arguments", () => {
  it("names every missing flag at once", () => {
    const read = turnUnblockInputs({ values: {} });
    expect(read.kind === "missing" ? read.flags : []).toEqual(["--channel", "--message-ts", "--note"]);
  });

  it("accepts a complete invocation", () => {
    const read = turnUnblockInputs({ values: { channel: "C1", "message-ts": "1785000000.000100", note: "signed in" } });
    expect(read.kind).toBe("ready");
    expect(read.kind === "ready" ? read.note : undefined).toBe("signed in");
  });

  it("prints a resume over the SAME brief the block left standing", () => {
    expect(resumeCommandFor({ ask: BASE })).toContain("--brief ~/.slopweaver/briefs/C1-1785000000.000100.json");
  });
});

describe("how a blocked row is read", () => {
  it("carries the permalink token a briefing card has to link, and the resume command", () => {
    const json = blockedRowJson({ row: A_ROW });
    expect(json["permalinkToken"]).toBe("p1785000000000100");
    expect(json["standing"]).toBe("waiting");
    expect(json["need"]).toBe("sign-in");
    expect(json["blockedIso"]).toBe("2026-09-07T00:20:00.000Z");
    expect(json["resumeCommand"]).toContain("slopweaver turn dispatch");
    expect(json["clearedNote"]).toBeUndefined();
  });

  it("carries what the owner did on a row they have already cleared", () => {
    const json = blockedRowJson({ row: { ...A_ROW, clearedNote: "signed in", standing: "ready-to-resume" } });
    expect(json["standing"]).toBe("ready-to-resume");
    expect(json["clearedNote"]).toBe("signed in");
  });

  it("states WHEN the block was entered and never how long ago", () => {
    const line = blockedRowLine({ row: A_ROW });
    expect(line).toBe(
      "C1/1785000000.000100  waiting on the owner  [sign-in, since 2026-09-07T00:20:00.000Z]  sign in to Google Cloud locally",
    );
    for (const word of ["ago", "overdue", "stale", "days"]) {
      expect(line.includes(word)).toBe(false);
    }
  });

  it("says a cleared row is owed a resume rather than waiting", () => {
    expect(blockedRowLine({ row: { ...A_ROW, standing: "ready-to-resume" } })).toContain(
      "the owner did it — owed a resume",
    );
  });
});
