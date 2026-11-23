import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { knowledgeAnswerCommand, runKnowledgeAnswer } from "../../../cli/commands/knowledge/answer.js";
import { knowledgeListCommand, runKnowledgeList } from "../../../cli/commands/knowledge/list.js";
import { knowledgeProposeCommand, runKnowledgeProposeWithDeps } from "../../../cli/commands/knowledge/propose.js";
import { knowledgeQuizCommand, runKnowledgeQuiz } from "../../../cli/commands/knowledge/quiz.js";
import { knowledgeQuizAnswerCommand, runKnowledgeQuizAnswer } from "../../../cli/commands/knowledge/quizAnswer.js";
import {
  knowledgeRecordCommand,
  runKnowledgeRecord,
  runKnowledgeRecordWithDeps,
} from "../../../cli/commands/knowledge/record.js";
import { knowledgeVoiceCommand, runKnowledgeVoice } from "../../../cli/commands/knowledge/voice.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { knowledgeManifest } from "../../../cli/manifests/knowledge.js";
import { cutQuestion } from "../../../knowledge/quiz/cut.js";
import { appendQuizEvent, readQuiz } from "../../../knowledge/quiz/store.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { readBatch, writeBatch } from "../../../knowledge/voice/batch.js";
import { buildProposal } from "../../../knowledge/voice/propose.js";
import { appendProposal, readProposals } from "../../../knowledge/voice/store.js";
import type { VoiceUnit } from "../../../knowledge/voice/types.js";
import { countWords, openProposals, voiceUnitId } from "../../../knowledge/voice/unit.js";
import { unwrap } from "../../../lib/result.js";
import { STORE_URL_ENV } from "../../../store/client.js";
import { type KnowledgeDomainFake, knowledgeDomainFake } from "../../knowledgeDomainFixture.js";

/** The owner's words, wrapped the way an archive turn file wraps one, so a quote check has something real to hit. */
const HIS_WORDS = "OWNER TURN 96-2 — verbatim:\n\nHey, do we ever build up that gold? I'm not actually sure.";

const cleanups: (() => void)[] = [];

/**
 * One fleet lesson, for the quiz ledger fixtures. Built here rather than read from a register, because the
 * register is the memories table now and a unit test may not reach one.
 */
const fleetLesson = (): LessonRow => ({
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-0000000000000001",
  learner: "fleet",
  recordedAtIso: "2026-09-12T01:00:00.000Z",
  run: "ad-hoc",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
});

/**
 * Every store-backed verb here is exercised against NO selected store, so its refusal is what is asserted.
 * A real database is proven outside this lane (`docs/store.md`) — `.claude/rules/testing.md` bans the mock
 * that would be needed to fake one, and a faked database proves the fake.
 */
let savedUrl: string | undefined;

beforeEach(() => {
  savedUrl = process.env[STORE_URL_ENV];
  delete process.env[STORE_URL_ENV];
});

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
  if (savedUrl === undefined) {
    delete process.env[STORE_URL_ENV];
    return;
  }
  process.env[STORE_URL_ENV] = savedUrl;
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-knowledge-cmd-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** The argv shape the runners slice: node, index.js, noun, verb, then the verb's own flags. */
function argv({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "index.js", "knowledge", "verb", ...flags];
}

/**
 * Run `knowledge record` over an in-memory domain store, so a refusal before the write is reached without a database.
 *
 * @param flags the verb's own flags
 * @returns the exit code
 */
function recordOverFake({ flags }: { flags: readonly string[] }): Promise<number> {
  return runKnowledgeRecordWithDeps({ argv: argv({ flags }), deps: { domains: knowledgeDomainFake().port } });
}

/**
 * Run `knowledge propose` over an in-memory domain store.
 *
 * @param flags the verb's own flags
 * @param fake the store, when a test reads or moves it
 * @returns the exit code
 */
function propose({
  flags,
  fake = knowledgeDomainFake(),
}: {
  flags: readonly string[];
  fake?: KnowledgeDomainFake;
}): Promise<number> {
  return runKnowledgeProposeWithDeps({ argv: argv({ flags }), deps: { domains: fake.port } });
}

/** A complete valid record invocation against one home, varying only what a test overrides. */
function recordFlags({ root, extra = [] }: { root: string; extra?: readonly string[] }): readonly string[] {
  return [
    "--home",
    root,
    "--domain",
    "datadog",
    "--claim",
    "a grouped count over an id-like facet truncates",
    "--verdict",
    "confirmed",
    "--tier",
    "2",
    "--surface",
    "api",
    "--evidence",
    "5 of 5 buckets plus meta.page.after over a closed 12h window",
    ...extra,
  ];
}

describe("every knowledge verb the manifest advertises is reachable", () => {
  it("exports a run function per verb", () => {
    expect([
      typeof knowledgeAnswerCommand,
      typeof knowledgeListCommand,
      typeof knowledgeQuizCommand,
      typeof knowledgeQuizAnswerCommand,
      typeof knowledgeProposeCommand,
      typeof knowledgeRecordCommand,
      typeof knowledgeVoiceCommand,
    ]).toEqual(["function", "function", "function", "function", "function", "function", "function"]);
  });

  it("advertises exactly the nineteen verbs, in the order the catalog prints them", () => {
    expect(Object.keys(knowledgeManifest)).toEqual([
      "answer",
      "detect",
      "domains",
      "export",
      "import-lessons",
      "list",
      "propose",
      "prune",
      "quiz",
      "quiz-answer",
      "recall",
      "recalled",
      "record",
      "redact",
      "redaction-scan",
      "remember",
      "restore",
      "trace",
      "voice",
    ]);
  });

  it("writes only local state — neither a lesson nor a belief of the owner's ever reaches a provider", () => {
    // The store-backed verbs are local-state too: the memories table is a Postgres on this machine,
    // not a doored provider, so AGENTS.md rule 3 has nothing to route.
    expect(Object.values(knowledgeManifest).map((entry) => entry.meta.effect)).toEqual([
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
    ]);
  });
});

describe("knowledge record", () => {
  it("REFUSES with the store's own reason rather than writing a lesson nowhere", async () => {
    // The whole property the cutover rests on. This verb once appended to a file and
    // could not fail for want of a database; the register IS the database, so a row that cannot be
    // written must exit non-zero carrying why — the settle gate reads what this wrote, and a lesson that
    // silently landed nowhere would let that gate refuse a run which had answered.
    expect(await runKnowledgeRecord(argv({ flags: recordFlags({ root: home() }) }))).toBe(EXIT_ERROR);
  });

  it("refuses a verdict outside the closed vocabulary as a USAGE error, before any connection", async () => {
    const flags = recordFlags({ root: home() }).map((entry) => (entry === "confirmed" ? "probably" : entry));

    expect(await recordOverFake({ flags })).toBe(EXIT_USAGE);
  });

  it("refuses a missing --evidence as a USAGE error, so a claim is never stored bare", async () => {
    const root = home();

    expect(
      await recordOverFake({ flags: ["--home", root, "--domain", "datadog", "--claim", "x", "--tier", "2"] }),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a domain that is not a slug as a DOMAIN error, not a usage one", async () => {
    const flags = recordFlags({ root: home() }).map((entry) => (entry === "datadog" ? "Datadog Logs" : entry));

    expect(await recordOverFake({ flags })).toBe(EXIT_ERROR);
  });

  it("prints help without opening a connection", async () => {
    expect(await runKnowledgeRecord(argv({ flags: ["--help", "--home", home()] }))).toBe(EXIT_OK);
  });
});

describe("knowledge list", () => {
  it("REFUSES rather than printing an empty register when the store is unreachable", async () => {
    // "nothing has been recorded" and "the store is down" lead to opposite next actions, and this verb is
    // how a session checks the first — so the second may never render as the first.
    expect(await runKnowledgeList(argv({ flags: ["--home", home()] }))).toBe(EXIT_ERROR);
  });

  it("refuses an unparseable flag as a usage error", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--not-a-flag"] }))).toBe(EXIT_USAGE);
  });

  it("prints help without opening a connection", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });
});

describe("the --learner flag", () => {
  it("refuses a learner outside the vocabulary rather than recording it on the fleet's side", async () => {
    const flags = recordFlags({ extra: ["--learner", "ada"], root: home() });

    expect(await recordOverFake({ flags })).toBe(EXIT_USAGE);
  });

  it("accepts either real member on the write side, reaching the store rather than refusing the flag", async () => {
    const owner = recordFlags({ extra: ["--learner", "owner"], root: home() });
    const fleet = recordFlags({ extra: ["--learner", "fleet"], root: home() });

    expect(await runKnowledgeRecord(argv({ flags: owner }))).toBe(EXIT_ERROR);
    expect(await runKnowledgeRecord(argv({ flags: fleet }))).toBe(EXIT_ERROR);
  });

  it("refuses an unknown learner on the read side too", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--home", home(), "--learner", "ada"] }))).toBe(EXIT_USAGE);
  });
});

describe("a filter typed wrong refuses rather than reading the register unfiltered", () => {
  it("refuses an unknown verdict", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--home", home(), "--verdict", "confimed"] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown tier", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--home", home(), "--tier", "5"] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown surface", async () => {
    expect(await runKnowledgeList(argv({ flags: ["--home", home(), "--surface", "graphql"] }))).toBe(EXIT_USAGE);
  });

  it("reaches the store for every REAL member, so the usage refusal above is about the typo", async () => {
    // The pair is the assertion: a typo stops at EXIT_USAGE having read nothing, while a valid vocabulary
    // gets all the way to the connection and fails there. Asserting only the first would pass for a verb
    // that refused every filter.
    const flags = ["--home", home(), "--verdict", "confirmed", "--tier", "2", "--surface", "api"];

    expect(await runKnowledgeList(argv({ flags }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge voice", () => {
  it("succeeds against a home holding none of the owner's speech, and hands over nothing", () => {
    expect(runKnowledgeVoice(argv({ flags: ["--home", home()] }))).toBe(EXIT_OK);
  });

  it("refuses a source outside the vocabulary rather than silently reading all three", () => {
    expect(runKnowledgeVoice(argv({ flags: ["--home", home(), "--source", "slack"] }))).toBe(EXIT_USAGE);
  });

  it("accepts each real family", () => {
    const root = home();
    expect(runKnowledgeVoice(argv({ flags: ["--home", root, "--source", "tick-ledger"] }))).toBe(EXIT_OK);
    expect(runKnowledgeVoice(argv({ flags: ["--home", root, "--source", "archive-turn"] }))).toBe(EXIT_OK);
    expect(runKnowledgeVoice(argv({ flags: ["--home", root, "--source", "scratch-turn"] }))).toBe(EXIT_OK);
  });

  it("prints help without reading anything", () => {
    expect(runKnowledgeVoice(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });
});

describe("knowledge propose", () => {
  it("refuses a call with no batch and no unit as a usage error", async () => {
    expect(await propose({ flags: ["--home", home()] })).toBe(EXIT_USAGE);
  });

  it("refuses a batch file that is not there", async () => {
    const root = home();
    expect(
      await propose({
        flags: ["--home", root, "--from", join(root, "absent.jsonl"), "--unit", "u-1", "--none", "nothing"],
      }),
    ).toBe(EXIT_ERROR);
  });

  it("prints help without writing anything", async () => {
    expect(await propose({ flags: ["--help"] })).toBe(EXIT_OK);
  });

  it("refuses contradictory flags as a usage error before it reads the batch file", async () => {
    const root = home();
    expect(
      await propose({
        flags: [
          "--home",
          root,
          "--from",
          join(root, "absent.jsonl"),
          "--unit",
          "u-1",
          "--none",
          "nothing",
          "--domain",
          "made-up-system",
        ],
      }),
    ).toBe(EXIT_USAGE);
  });

  it("queues a committed domain, and refuses one this home never configured without queuing it", async () => {
    const root = home();
    const fake = knowledgeDomainFake();
    const batch = join(root, "batch.jsonl");
    expect(runKnowledgeVoice(argv({ flags: ["--home", root, "--out", batch] }))).toBe(EXIT_OK);
    const unit: VoiceUnit = {
      id: voiceUnitId({ text: HIS_WORDS }),
      locator: "/tmp/owner-turn.txt",
      occurrences: 1,
      source: "archive-turn",
      text: HIS_WORDS,
      wrapped: true,
      words: countWords({ text: HIS_WORDS }),
    };
    unwrap(
      writeBatch({ batch: { units: [unit], watermark: unwrap(readBatch({ path: batch })).watermark }, path: batch }),
    );
    const proposeIn = ({ domain }: { domain: string }): Promise<number> =>
      propose({
        fake,
        flags: [
          "--home",
          root,
          "--from",
          batch,
          "--unit",
          unit.id,
          "--domain",
          domain,
          "--claim",
          "The gold tier is not yet being built up.",
          "--quote",
          "do we ever build up that gold",
          "--held",
          "stated-uncertain",
        ],
      });

    expect(await proposeIn({ domain: "made-up-system" })).toBe(EXIT_ERROR);
    expect(unwrap(readProposals({ home: root }))).toEqual([]);
    expect(
      await propose({
        fake,
        flags: ["--home", root, "--from", batch, "--unit", unit.id, "--none", "nothing", "--domain", "made-up-system"],
      }),
    ).toBe(EXIT_USAGE);
    expect(unwrap(readProposals({ home: root }))).toEqual([]);
    expect(await proposeIn({ domain: "corpus" })).toBe(EXIT_OK);
    expect(unwrap(readProposals({ home: root })).map((row) => row.kind)).toEqual(["proposed"]);

    fake.state.readFailure = "connection reset by acme-db";
    expect(
      await propose({ fake, flags: ["--home", root, "--from", batch, "--unit", unit.id, "--none", "nothing"] }),
    ).toBe(EXIT_ERROR);
    expect(unwrap(readProposals({ home: root })).map((row) => row.kind)).toEqual(["proposed"]);
  });
});

describe("knowledge answer", () => {
  it("refuses a call naming no proposal as a usage error", () => {
    expect(runKnowledgeAnswer(argv({ flags: ["--home", home(), "--mark", "right", "--why", "yep"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a mark outside the owner's three", () => {
    expect(
      runKnowledgeAnswer(argv({ flags: ["p-0123456789abcdef", "--home", home(), "--mark", "maybe", "--why", "hmm"] })),
    ).toBe(EXIT_USAGE);
  });

  it("refuses an answer carrying no owner words, even though the mark alone is a fine answer", () => {
    expect(runKnowledgeAnswer(argv({ flags: ["p-0123456789abcdef", "--home", home(), "--mark", "right"] }))).toBe(
      EXIT_USAGE,
    );
  });

  it("refuses an id an empty queue never proposed, rather than writing a row nothing answers", () => {
    expect(
      runKnowledgeAnswer(argv({ flags: ["p-0123456789abcdef", "--home", home(), "--mark", "right", "--why", "yep"] })),
    ).toBe(EXIT_ERROR);
  });

  it("records the owner's mark against a proposal the queue really holds, and writes no register row", () => {
    const root = home();
    const batch = join(root, "batch.jsonl");
    expect(runKnowledgeVoice(argv({ flags: ["--home", root, "--out", batch] }))).toBe(EXIT_OK);
    const unit: VoiceUnit = {
      id: voiceUnitId({ text: HIS_WORDS }),
      locator: "/tmp/owner-turn.txt",
      occurrences: 1,
      source: "archive-turn",
      text: HIS_WORDS,
      wrapped: true,
      words: 8,
    };
    const proposal = unwrap(
      buildProposal({
        claim: "The gold tier is being built up as the corpus grows.",
        domain: "slopweaver-corpus",
        held: "stated-uncertain",
        quote: "do we ever build up that gold",
        reviewedAtIso: "2026-09-12T01:00:00.000Z",
        run: "half-kept-ledger-a",
        unit,
      }),
    );
    unwrap(appendProposal({ home: root, row: proposal }));

    expect(
      runKnowledgeAnswer(
        argv({ flags: [proposal.proposalId, "--home", root, "--mark", "partly", "--why", "close, wrong tier"] }),
      ),
    ).toBe(EXIT_OK);

    const queue = unwrap(readProposals({ home: root }));
    expect(queue.map((row) => row.kind)).toEqual(["proposed", "answered"]);
    expect(openProposals({ proposals: queue })).toEqual([]);
  });

  it("refuses a second answer to the same proposal, so what the owner said first is never overwritten", () => {
    const root = home();
    const unit: VoiceUnit = {
      id: voiceUnitId({ text: HIS_WORDS }),
      locator: "/tmp/owner-turn.txt",
      occurrences: 1,
      source: "archive-turn",
      text: HIS_WORDS,
      wrapped: true,
      words: 8,
    };
    const proposal = unwrap(
      buildProposal({
        claim: "The gold tier is being built up as the corpus grows.",
        domain: "slopweaver-corpus",
        held: "stated-uncertain",
        quote: "do we ever build up that gold",
        reviewedAtIso: "2026-09-12T01:00:00.000Z",
        run: "half-kept-ledger-a",
        unit,
      }),
    );
    unwrap(appendProposal({ home: root, row: proposal }));
    const flags = [proposal.proposalId, "--home", root, "--mark", "right", "--why", "yep"];

    expect(runKnowledgeAnswer(argv({ flags }))).toBe(EXIT_OK);
    expect(runKnowledgeAnswer(argv({ flags }))).toBe(EXIT_ERROR);
  });

  it("prints help without writing anything", () => {
    expect(runKnowledgeAnswer(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });
});

describe("knowledge quiz", () => {
  it("refuses a call naming no sweep as a usage error, before any connection", async () => {
    expect(await runKnowledgeQuiz(argv({ flags: ["--home", home()] }))).toBe(EXIT_USAGE);
  });

  it("REFUSES an unreachable register rather than recording that the sweep asked nothing", async () => {
    // That `empty` row is what stops the next render re-cutting, so writing one because the store was down
    // would retire a question nobody was ever asked.
    const root = home();

    expect(await runKnowledgeQuiz(argv({ flags: ["--home", root, "--sweep", "tick-1"] }))).toBe(EXIT_ERROR);
    expect(unwrap(readQuiz({ home: root }))).toEqual([]);
  });

  it("prints help without reading anything", async () => {
    expect(await runKnowledgeQuiz(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });
});

describe("knowledge quiz-answer", () => {
  it("refuses a call with no id and no answer as a usage error", () => {
    expect(runKnowledgeQuizAnswer(argv({ flags: ["--home", home()] }))).toBe(EXIT_USAGE);
  });

  it("refuses an id an empty ledger never cut", () => {
    expect(runKnowledgeQuizAnswer(argv({ flags: ["q-0123456789abcdef", "--home", home(), "--answer", "yes"] }))).toBe(
      EXIT_ERROR,
    );
  });

  it("records the owner's words against a question the ledger already holds, reaching no register at all", () => {
    // The ledger is a file and the register is the database, so this verb succeeding with NO store selected
    // is the falsifiable witness that answering writes nothing to the register — a version that recorded a
    // row would now fail on the connection rather than pass quietly.
    const root = home();
    const selected = cutQuestion({
      events: [],
      nowIso: "2026-09-12T02:00:00.000Z",
      rows: [fleetLesson()],
      sweepId: "tick-1",
      traces: [],
    });
    unwrap(appendQuizEvent({ event: selected.write!, home: root }));
    const id = selected.question!.quizId;

    expect(
      runKnowledgeQuizAnswer(argv({ flags: [id, "--home", root, "--answer", "no, only on the read replica"] })),
    ).toBe(EXIT_OK);
    expect(unwrap(readQuiz({ home: root })).map((event) => event.kind)).toEqual(["selected", "answered"]);
  });

  it("prints help without writing anything", () => {
    expect(runKnowledgeQuizAnswer(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });
});
