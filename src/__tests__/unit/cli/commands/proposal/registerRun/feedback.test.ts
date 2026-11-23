/*
 * The feedback ledger verbs — `record-feedback`, `answer-feedback` and `feedback`: ids allocated in order and one
 * answered by name, an unknown id refused with the ids it has, `--where` required only for kinds owing an answer,
 * no id allocated over an undecodable journal, and `--unanswered` listing only what still owes one.
 */
import { appendFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type ProposalRegisterDeps, runProposalFeedback } from "../../../../../../cli/commands/proposal/registerRun.js";
import {
  runProposalAnswerFeedback,
  runProposalRecordFeedback,
} from "../../../../../../cli/commands/proposal/registerRunFeedbackWrite.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry, registerJournalPath } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("the feedback ledger verbs", () => {
  function recordPushback({ home, deps }: { home: string; deps: ProposalRegisterDeps }): number {
    return runProposalRecordFeedback({
      argv: argv({
        rest: [
          "a-slug",
          "--kind",
          "pushback",
          "--who",
          "a reviewer",
          "--what",
          "too broad",
          "--where",
          "https://slack.test/1",
          "--home",
          home,
        ],
        verb: "record-feedback",
      }),
      deps,
    });
  }

  it("assigns f1 then f2, and answering closes exactly the one named", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    expect(recordPushback({ deps: h.deps, home })).toBe(EXIT_OK);
    expect(recordPushback({ deps: h.deps, home })).toBe(EXIT_OK);
    expect(h.out).toEqual(["a-slug ← f1 (pushback) from a reviewer", "a-slug ← f2 (pushback) from a reviewer"]);
    const answered = harness();
    const code = runProposalAnswerFeedback({
      argv: argv({ rest: ["a-slug", "--id", "f2", "--how", "narrowed it", "--home", home], verb: "answer-feedback" }),
      deps: answered.deps,
    });
    expect(code).toBe(EXIT_OK);
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!;
    expect(entry.feedback[0]!.answer).toBe(undefined);
    expect(entry.feedback[1]!.answer!.how).toBe("narrowed it");
  });

  it("refuses an answer whose id names nothing, listing what it does have", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    recordPushback({ deps: h.deps, home });
    const answered = harness();
    const code = runProposalAnswerFeedback({
      argv: argv({ rest: ["a-slug", "--id", "f7", "--how", "x", "--home", home], verb: "answer-feedback" }),
      deps: answered.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(answered.err).toEqual(['no feedback "f7" on a-slug — it has f1']);
  });

  it("requires --where for pushback, since answering means going back to where it was raised", () => {
    const h = harness();
    const code = runProposalRecordFeedback({
      argv: argv({
        rest: ["a-slug", "--kind", "pushback", "--who", "a reviewer", "--what", "too broad"],
        verb: "record-feedback",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.err[0]).toContain("--where <permalink> is required for pushback and question");
  });

  it("does NOT require --where for an acknowledgement, which owes no answer", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalRecordFeedback({
      argv: argv({
        rest: ["a-slug", "--kind", "acknowledgement", "--who", "someone", "--what", "sounds good", "--home", home],
        verb: "record-feedback",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
  });

  it("refuses to allocate an id while any journal line is undecodable", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    appendFileSync(registerJournalPath({ home, slug: "a-slug" }), '{"kind":"from-the-future","atIso":"2026-09-01"}\n');
    const h = harness();
    const code = recordPushback({ deps: h.deps, home });
    expect(code).toBe(EXIT_ERROR);
    expect(h.err[0]).toContain("line(s) 2 cannot be decoded by this build");
  });

  it("lists only the kinds that owe an answer under --unanswered", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    recordPushback({ deps: h.deps, home });
    runProposalRecordFeedback({
      argv: argv({
        rest: ["a-slug", "--kind", "support", "--who", "a fan", "--what", "love it", "--home", home],
        verb: "record-feedback",
      }),
      deps: h.deps,
    });
    const all = harness();
    runProposalFeedback({ argv: argv({ rest: ["--home", home], verb: "feedback" }), deps: all.deps });
    expect(all.out.length).toBe(2);
    const owing = harness();
    runProposalFeedback({
      argv: argv({ rest: ["--unanswered", "--home", home], verb: "feedback" }),
      deps: owing.deps,
    });
    expect(owing.out.length).toBe(1);
    expect(owing.out[0]).toContain("f1 (pushback) a reviewer: too broad");
    expect(owing.out[0]).toContain("UNANSWERED");
  });
});
