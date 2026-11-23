/**
 * The turn's module layering, and the two pieces of it that are not just prose.
 *
 * `run.ts` was one 551-line file holding all six orderings it documents. Split, the numbered list STAYS in
 * `run.ts`, because an ordering is a relation between phases and no phase module can state one. What each
 * module gets instead is a pointer to the number it serves, and this file asserts that every one of them
 * carries it, so a module can never drift into serving an ordering its own header does not name.
 *
 * The second piece is the re-export block. Every name a consumer outside `src/live/turn/` imports through
 * `run.js` comes from there, which is why the split repointed nothing. A test that pins the exact set is
 * what turns "no consumer changes" from something a reader has to take on faith into something that fails.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { Mention } from "../../../../live/listen/mention.js";
import { turnStepsForTier } from "../../../../live/turn/answer.js";
import type { TurnProvenance } from "../../../../live/turn/envelope.js";
import type { HoldSink, PostedRef, TurnPoster } from "../../../../live/turn/runContract.js";
import { AnswerSendRefusals, DoorRefusedError, TurnRefusedError } from "../../../../live/turn/runContract.js";
import { beginTurn } from "../../../../live/turn/turnBegin.js";
import { advance, reasonOf } from "../../../../live/turn/turnCursor.js";
import { deliverAnswer } from "../../../../live/turn/turnDelivery.js";
import { turnIndicatorSeams } from "../../../../live/turn/turnQuery.js";
import { terminalStateForThrow } from "../../../../live/turn/turnSettle.js";
import { reportWithheld } from "../../../../live/turn/turnWithheld.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";

/** Every module of the family, in the order a lower layer may never import an upper one. */
const LADDER = [
  "turnCursor.ts",
  "turnBegin.ts",
  "turnQuery.ts",
  "turnWithheld.ts",
  "turnDelivery.ts",
  "turnSettle.ts",
  "run.ts",
] as const;

/** The six phase modules. `run.ts` is the shell that sequences them and owns the numbered list. */
const PHASES = LADDER.slice(0, 6);

/** Which numbered ordering each phase module is the home of. `turnBegin` earns two, being one act. */
const ORDERING_OF: Readonly<Record<string, readonly string[]>> = {
  "turnBegin.ts": ["0", "1"],
  "turnCursor.ts": ["2"],
  "turnDelivery.ts": ["3"],
  "turnQuery.ts": ["1"],
  "turnSettle.ts": ["4"],
  "turnWithheld.ts": ["5"],
};

const sourceOf = ({ file }: { file: string }): string =>
  readFileSync(new URL(`../../../../live/turn/${file}`, import.meta.url), "utf8");

/** Which sibling modules `file` imports from, ignoring every import outside this family. */
const familyImportsOf = ({ file }: { file: string }): readonly string[] =>
  [...sourceOf({ file }).matchAll(/from "\.\/(\w+)\.js";/gu)]
    .map((m) => `${m[1]!}.ts`)
    .filter((name) => LADDER.includes(name as (typeof LADDER)[number]));

/** The file overview, which is the block ending at the first line that is not part of it. */
const overviewOf = ({ file }: { file: string }): string => sourceOf({ file }).split("*/")[0]!;

describe("the module ladder", () => {
  it("covers every module of the family", () => {
    expect(LADDER.length).toBe(7);
    expect(PHASES.length).toBe(6);
    expect(Object.keys(ORDERING_OF).length).toBe(6);
  });

  it("has no backward import edge", () => {
    const backwards = LADDER.flatMap((file, depth) =>
      familyImportsOf({ file })
        .filter((target) => LADDER.indexOf(target as (typeof LADDER)[number]) >= depth)
        .map((target) => `${file} -> ${target}`),
    );
    expect(backwards).toEqual([]);
  });

  it("puts settle above delivery, because settledDelivery is a catch around it", () => {
    expect(familyImportsOf({ file: "turnSettle.ts" })).toEqual(["turnCursor.ts", "turnDelivery.ts"]);
    expect(familyImportsOf({ file: "turnDelivery.ts" })).toEqual(["turnWithheld.ts"]);
  });
});

describe("every phase module names the ordering it serves", () => {
  it("carries its own number in its overview", () => {
    const silent = PHASES.filter((file) => {
      const overview = overviewOf({ file });
      return !ORDERING_OF[file]!.every(
        (n) => overview.includes(`Ordering${n === "0" ? "s" : ""}`) || overview.includes(n),
      );
    });
    expect(silent).toEqual([]);
  });

  // The falsifiable half: the numbered LIST itself is in run.ts and nowhere else, so a module that copied
  // it wholesale rather than pointing at it would fail here.
  it("leaves the list itself in run.ts alone", () => {
    expect(sourceOf({ file: "run.ts" })).toContain("The five orderings this file exists to guarantee");
    const copies = PHASES.filter((file) =>
      sourceOf({ file }).includes("The five orderings this file exists to guarantee"),
    );
    expect(copies).toEqual([]);
  });

  it("points every phase module back at the shell", () => {
    const unlinked = PHASES.filter((file) => !overviewOf({ file }).includes("{@link ./run}"));
    expect(unlinked).toEqual([]);
  });
});

describe("the re-export block is why nothing outside this file was repointed", () => {
  it("still forwards every name a consumer reaches through run.js", () => {
    const text = sourceOf({ file: "run.ts" });
    const forwarded = [
      "AnswerSendRefusals",
      "DoorRefusedError",
      "TURN_STATUS_TEXT",
      "TurnQueryFailure",
      "TurnRefusedError",
      "type AnswerSendRefusal",
      "type HoldSink",
      "type PostAnswerOutcome",
      "type PostedRef",
      "type TurnPoster",
      "type TurnQuery",
      "type TurnSupersession",
    ];
    expect(forwarded.length).toBeGreaterThan(0);
    const missing = forwarded.filter((name) => !text.includes(`  ${name},`));
    expect(missing).toEqual([]);
    expect(text).toContain('export type { TurnProvenance } from "./envelope.js";');
  });
});

describe("terminalStateForThrow tells a gate saying no apart from a break", () => {
  it("calls a DOOR refusal refused, carrying the door's own words to the reader", () => {
    const state = terminalStateForThrow({ error: new DoorRefusedError("the answer cited nothing checkable") });
    expect(state.kind).toBe("refused");
    expect(state.reason).toBe("the answer cited nothing checkable");
    expect(state.readerReason).toBe("the answer cited nothing checkable");
  });

  // The subclass is the test, never the parent: a plain TurnRefusedError is this repo refusing its own
  // malformed work, which `refused` would dress up as a gate decision it never was.
  it("calls a plain TurnRefusedError failed, and does not repeat its words to the reader", () => {
    const state = terminalStateForThrow({ error: new TurnRefusedError("answer form rejected") });
    expect(state.kind).toBe("failed");
    expect(state.reason).toBe("answer form rejected");
    expect(state.readerReason).toBe("the composed answer did not clear its own checks before it could be sent");
  });

  it("names a non-Error throw without pretending it was one", () => {
    expect(reasonOf({ error: "a bare string" })).toBe("a bare string");
    expect(reasonOf({ error: new Error("a real one") })).toBe("a real one");
    expect(terminalStateForThrow({ error: 42 }).reason).toBe("42");
  });
});

describe("advance moves the cursor before it edits the message", () => {
  it("records the detail at the position it is leaving, then steps forward", async () => {
    const seen: { steps: readonly { readonly state: string }[] }[] = [];
    const poster = {
      advanceWorking: async ({ steps }: { steps: readonly { readonly state: string }[] }) => {
        seen.push({ steps });
      },
    } as unknown as TurnPoster;
    const posted: PostedRef = { channel: "C1", ts: "1.1" };
    const steps = turnStepsForTier({ tier: "inline" });
    const cursor = { completed: 0, details: [] as (string | undefined)[] };

    await advance({ cursor, detail: "read 3 records", posted, poster, steps, task: "t" });
    expect(cursor.completed).toBe(1);
    expect(cursor.details[0]).toBe("read 3 records");
    expect(seen.length).toBe(1);
    expect(seen[0]!.steps[0]!.state).toBe("done");
  });

  it("never steps past the last step, however many times it is called", async () => {
    const poster = { advanceWorking: async () => {} } as unknown as TurnPoster;
    const posted: PostedRef = { channel: "C1", ts: "1.1" };
    const steps = turnStepsForTier({ tier: "inline" });
    const cursor = { completed: 0, details: [] as (string | undefined)[] };
    for (let i = 0; i < steps.length + 3; i += 1) {
      await advance({ cursor, detail: `step ${String(i)}`, posted, poster, steps, task: "t" });
    }
    expect(cursor.completed).toBe(steps.length);
  });
});

describe("turnIndicatorSeams settles the checklist without a card to settle", () => {
  it("calls a turn that posted nothing settled, touching the poster not at all", async () => {
    const log: string[] = [];
    const poster = {
      deleteWorking: async () => {
        log.push("delete-working");
        return true;
      },
      finalizeWorking: async () => {
        log.push("finalize");
        return true;
      },
    } as unknown as TurnPoster;
    const seams = turnIndicatorSeams({
      cursor: { completed: 0, details: [] },
      poster,
      steps: turnStepsForTier({ tier: "inline" }),
      task: "t",
    });
    expect(await seams.settleChecklist({ checklist: { detail: "answered from two reads", kind: "done" } })).toBe(true);
    expect(log).toEqual([]);
  });

  // Ordering 3's fallback, and the reason the delete is tried FIRST: a real answer replaces the working
  // message, and only a delete that fails leaves a finished checklist standing in its place.
  it("falls back to finalising in place when the delete fails", async () => {
    const log: string[] = [];
    const poster = {
      deleteWorking: async () => {
        log.push("delete-working");
        return false;
      },
      finalizeWorking: async () => {
        log.push("finalize");
        return true;
      },
    } as unknown as TurnPoster;
    const seams = turnIndicatorSeams({
      cursor: { completed: 1, details: ["read 3 records"] },
      posted: { channel: "C1", ts: "1.1" },
      poster,
      steps: turnStepsForTier({ tier: "inline" }),
      task: "t",
    });
    expect(await seams.settleChecklist({ checklist: { detail: "answered from two reads", kind: "done" } })).toBe(true);
    expect(log).toEqual(["delete-working", "finalize"]);
  });

  it("does not try the delete at all when the checklist did not finish", async () => {
    const log: string[] = [];
    const poster = {
      deleteWorking: async () => {
        log.push("delete-working");
        return true;
      },
      finalizeWorking: async () => {
        log.push("finalize");
        return true;
      },
    } as unknown as TurnPoster;
    const seams = turnIndicatorSeams({
      cursor: { completed: 1, details: ["read 3 records"] },
      posted: { channel: "C1", ts: "1.1" },
      poster,
      steps: turnStepsForTier({ tier: "inline" }),
      task: "t",
    });
    expect(await seams.settleChecklist({ checklist: { kind: "failed", reason: "boom" } })).toBe(true);
    expect(log).toEqual(["finalize"]);
  });
});

/** A mention as the transport hands it over, every tag already stripped by `listen/mention.ts`. */
const MENTION: Mention = {
  channel: "C1",
  messageTs: "1712345678.000200",
  surface: "channel",
  text: "what did we decide about the renderer?",
  threadTs: "1712345678.000100",
  userId: "U_ASKER",
};

/** The same question in a 1:1 DM, the one surface that also gets a thread title. */
const DM_MENTION: Mention = { ...MENTION, channel: "D1", surface: "dm" };

const PROVENANCE: TurnProvenance = {
  modelId: "visible supervisor",
  supervisor: { host: "codex", id: "thread-1" },
};

const ANSWER = {
  body: [],
  documents: [],
  images: [],
  index: [],
  kind: "answer",
  lead: "We render rich_text.",
  measurements: [],
} as unknown as AnswerFormAnswer;

describe("beginTurn names the thread before it posts into it", () => {
  it("sets the title first in a DM, and seeds step 0 as already done", async () => {
    const log: string[] = [];
    const poster = {
      postWorking: async () => {
        log.push("post-working");
        return { channel: "D1", ts: "1.1" };
      },
      setTitle: async () => {
        log.push("set-title");
        return ok(undefined);
      },
    } as unknown as TurnPoster;
    const begun = await beginTurn({
      mention: DM_MENTION,
      poster,
      started: undefined,
      steps: turnStepsForTier({ tier: "inline" }),
    });
    expect(log).toEqual(["set-title", "post-working"]);
    expect(begun.cursor.completed).toBe(1);
    expect(begun.titleFailure).toBe(undefined);
    expect(begun.question).toBe(MENTION.text);
  });

  // The falsifiable complement: the ordering above is only evidence because a channel turn, run through the
  // same function, produces no title call at all rather than one the assertion happened not to look at.
  it("never asks for a title in a channel, where no title row exists", async () => {
    const log: string[] = [];
    const poster = {
      postWorking: async () => {
        log.push("post-working");
        return { channel: "C1", ts: "1.1" };
      },
      setTitle: async () => {
        log.push("set-title");
        return ok(undefined);
      },
    } as unknown as TurnPoster;
    await beginTurn({ mention: MENTION, poster, started: undefined, steps: turnStepsForTier({ tier: "inline" }) });
    expect(log).toEqual(["post-working"]);
  });

  it("carries a refused title out as the one survivable failure rather than ending the turn", async () => {
    const poster = {
      postWorking: async () => ({ channel: "D1", ts: "1.1" }),
      setTitle: async () => err("not_allowed_token_type"),
    } as unknown as TurnPoster;
    const begun = await beginTurn({
      mention: DM_MENTION,
      poster,
      started: undefined,
      steps: turnStepsForTier({ tier: "inline" }),
    });
    expect(begun.titleFailure).toBe("not_allowed_token_type");
    expect(begun.posted.ts).toBe("1.1");
  });
});

describe("reportWithheld files the draft before it says so", () => {
  it("writes the queue entry first, so the id in the notice always names one that exists", async () => {
    const log: string[] = [];
    const hold: HoldSink = async () => {
      log.push("hold");
      return { id: "q-abcd1234" };
    };
    const poster = {
      displayNames: () => ({}),
      postNotice: async () => {
        log.push("post-notice");
        return { channel: "C1", ts: "2.2" };
      },
    } as unknown as TurnPoster;
    const outcome = await reportWithheld({
      answer: ANSWER,
      documents: [],
      hold,
      mention: MENTION,
      offered: { code: "unverified-claim", reason: "the answer cited nothing checkable" },
      poster,
      provenance: PROVENANCE,
      question: MENTION.text,
      uploads: [],
    });
    expect(log).toEqual(["hold", "post-notice"]);
    expect(outcome.answered).toBe(false);
    expect(outcome.answerTs).toBe("2.2");
    expect(outcome.withheld!.id).toBe("q-abcd1234");
  });

  it("still posts a notice when the queue write throws, and says the draft was not filed", async () => {
    const log: string[] = [];
    const hold: HoldSink = async () => {
      log.push("hold");
      throw new Error("queue is read-only");
    };
    const poster = {
      displayNames: () => ({}),
      postNotice: async () => {
        log.push("post-notice");
        return { channel: "C1", ts: "2.2" };
      },
    } as unknown as TurnPoster;
    const outcome = await reportWithheld({
      answer: ANSWER,
      documents: [],
      hold,
      mention: MENTION,
      offered: { code: "unverified-claim", reason: "the answer cited nothing checkable" },
      poster,
      provenance: PROVENANCE,
      question: MENTION.text,
      uploads: [],
    });
    expect(log).toEqual(["hold", "post-notice"]);
    expect(outcome.withheld).toBe(undefined);
    expect(outcome.failure).toBe("the draft was held but not filed: queue is read-only");
  });
});

describe("deliverAnswer routes the door's verdict", () => {
  it("answers, and reaches the withheld path not at all, when the door admits the answer", async () => {
    const log: string[] = [];
    const hold: HoldSink = async () => {
      log.push("hold");
      return { id: "q-neverused" };
    };
    const poster = {
      postAnswer: async () => {
        log.push("post-answer");
        return { kind: "posted", missingMedia: [], ref: { channel: "C1", ts: "3.3" } };
      },
      displayNames: () => ({}),
      postNotice: async () => {
        log.push("post-notice");
        return { channel: "C1", ts: "2.2" };
      },
    } as unknown as TurnPoster;
    const delivered = unwrap(
      await deliverAnswer({
        documents: [],
        hold,
        mention: MENTION,
        outcome: { answer: ANSWER, completionDetail: "answered from two reads", coverage: undefined },
        poster,
        provenance: PROVENANCE,
        question: MENTION.text,
        uploads: [],
      } as unknown as Parameters<typeof deliverAnswer>[0]),
    );
    expect(log).toEqual(["post-answer"]);
    expect(delivered.state.kind).toBe("answered");
    expect(delivered.state.reason).toBe("answered from two reads");
    expect(delivered.outcome.answerTs).toBe("3.3");
  });

  it("hands a refused answer to the withheld path, which files before it notices", async () => {
    const log: string[] = [];
    const hold: HoldSink = async () => {
      log.push("hold");
      return { id: "q-abcd1234" };
    };
    const poster = {
      postAnswer: async () => {
        log.push("post-answer");
        return { code: "unverified-claim", kind: "withheld", reason: "the answer cited nothing checkable" };
      },
      displayNames: () => ({}),
      postNotice: async () => {
        log.push("post-notice");
        return { channel: "C1", ts: "2.2" };
      },
    } as unknown as TurnPoster;
    const delivered = unwrap(
      await deliverAnswer({
        documents: [],
        hold,
        mention: MENTION,
        outcome: { answer: ANSWER, completionDetail: "answered from two reads", coverage: undefined },
        poster,
        provenance: PROVENANCE,
        question: MENTION.text,
        uploads: [],
      } as unknown as Parameters<typeof deliverAnswer>[0]),
    );
    expect(log).toEqual(["post-answer", "hold", "post-notice"]);
    expect(delivered.state.kind).toBe("withheld");
    expect(delivered.state.reason).toBe("the answer cited nothing checkable");
  });

  it("reports a warn-tier refusal as an Err, filing no draft and posting no notice", async () => {
    // `C0SYN000001/1790048248.995219`: this path treated a warn-tier refusal as an ENDING, and
    // the `failed` event it produced superseded the ask's dispatch record — so `turn answer --dispatch`
    // answered "no dispatch record found" for an answer the worker was still holding.
    const log: string[] = [];
    const hold: HoldSink = async () => {
      log.push("hold");
      return { id: "q-neverused" };
    };
    const poster = {
      postAnswer: async () => {
        log.push("post-answer");
        return {
          kind: "retryable-refusal",
          refusal: AnswerSendRefusals.warnRefused({ message: "the admit door refused — VOICE_RULE_BROKEN" }),
        };
      },
      displayNames: () => ({}),
      postNotice: async () => {
        log.push("post-notice");
        return { channel: "C1", ts: "2.2" };
      },
    } as unknown as TurnPoster;
    const refusal = unwrapErr(
      await deliverAnswer({
        documents: [],
        hold,
        mention: MENTION,
        outcome: { answer: ANSWER, completionDetail: "answered from two reads", coverage: undefined },
        poster,
        provenance: PROVENANCE,
        question: MENTION.text,
        uploads: [],
      } as unknown as Parameters<typeof deliverAnswer>[0]),
    );

    expect(log).toEqual(["post-answer"]);
    expect(refusal.code).toBe("ANSWER_SEND_WARN_REFUSED");
    expect(refusal.message).toBe("the admit door refused — VOICE_RULE_BROKEN");
  });
});
