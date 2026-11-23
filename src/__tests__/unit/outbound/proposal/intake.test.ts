/**
 * Question-first intake, and the store beneath it.
 *
 * The behaviour under test is a REFUSAL: a proposal must not advance past a question only its stakeholder
 * can settle. Everything else here is the identity the intake carries, which is the only thing that can name
 * a proposal across a draft, a publish and a re-publish — Notion assigns page ids, so nothing about the
 * document itself can.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { ProposalIntakeErrors } from "../../../../outbound/proposal/errors.js";
import {
  blockingUnanswered,
  canAdvance,
  deriveIntake,
  GAP_QUESTIONS,
  intakeId,
  intakeLines,
  mergeIntake,
  type ProposalIntake,
} from "../../../../outbound/proposal/intake.js";
import {
  intakeExists,
  isValidIntakeId,
  loadIntake,
  parseIntake,
  saveIntake,
} from "../../../../outbound/proposal/intakeStore.js";

const NOW = new Date("2026-08-22T02:00:00.000Z");

/** A published Notion address, as a legacy `pageId`/`pageUrl` record decodes to. */
const NOTION_ADDRESS = { id: "p-1", provider: "notion" as const, url: "https://n.test/p" };

/** The smallest record `parseIntake` reads, for the address cases to add one field to. */
const BARE = { brief: "b", id: "an-id", questions: [] };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-intake-"));
  fixtureDirs.push(dir);
  return dir;
}

/** The example intake, with every question answered. */
function answered(): ProposalIntake {
  const intake = deriveIntake({ brief: "a brief", id: "a-brief", now: NOW });
  return { ...intake, questions: intake.questions.map((question) => ({ ...question, answer: "yes" })) };
}

describe("intakeId", () => {
  it("derives a readable slug from the brief", () => {
    expect(intakeId({ brief: "An eval harness before we rework the ticket format", now: NOW })).toMatch(
      /^an-eval-harness-before-we-[a-z0-9]{5}$/,
    );
  });

  it("keeps at most five words, so the id stays usable on a command line", () => {
    const id = intakeId({ brief: "one two three four five six seven eight", now: NOW });
    expect(id.split("-").length).toBe(6);
  });

  it("falls back to a fixed stem when the brief has no usable characters", () => {
    expect(intakeId({ brief: "!!! ???", now: NOW })).toMatch(/^proposal-[a-z0-9]{5}$/);
  });

  it("produces a filename-safe id", () => {
    expect(isValidIntakeId({ id: intakeId({ brief: "A Brief: with punctuation!", now: NOW }) })).toBe(true);
  });
});

describe("isValidIntakeId", () => {
  it("refuses a traversal attempt, which would reach a filename", () => {
    expect(isValidIntakeId({ id: "../../etc/passwd" })).toBe(false);
  });

  it("refuses an uppercase id, so two ids cannot collide on a case-insensitive filesystem", () => {
    expect(isValidIntakeId({ id: "AnIntake" })).toBe(false);
  });

  it("accepts a derived slug", () => {
    expect(isValidIntakeId({ id: "an-eval-harness-k3f9x" })).toBe(true);
  });
});

describe("deriveIntake", () => {
  it("seeds every standing gap question, unanswered and blocking", () => {
    const intake = deriveIntake({ brief: "a brief", id: "a-brief", now: NOW });
    expect(intake.questions.map((question) => question.key)).toEqual(GAP_QUESTIONS.map(([key]) => key));
    expect(intake.questions.every((question) => question.blocking)).toBe(true);
    expect(blockingUnanswered({ intake }).length).toBe(GAP_QUESTIONS.length);
  });

  it("starts at the intake status", () => {
    expect(deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }).status).toBe("intake");
  });
});

describe("canAdvance", () => {
  it("refuses a fresh intake", () => {
    expect(canAdvance({ intake: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }) })).toBe(false);
  });

  it("allows one whose blocking questions are all answered", () => {
    expect(canAdvance({ intake: answered() })).toBe(true);
  });

  it("treats a blank answer as no answer", () => {
    const intake = answered();
    const blanked = { ...intake, questions: intake.questions.map((q, i) => (i === 0 ? { ...q, answer: "   " } : q)) };
    expect(canAdvance({ intake: blanked })).toBe(false);
  });

  it("ignores a non-blocking question that is still open", () => {
    const intake = answered();
    const extra = { ...intake, questions: [...intake.questions, { blocking: false, key: "extra", question: "?" }] };
    expect(canAdvance({ intake: extra })).toBe(true);
  });
});

describe("intakeLines", () => {
  it("marks each question OPEN or answered, showing the answer once there is one", () => {
    const lines = intakeLines({ intake: answered() });
    expect(lines[0]).toBe("intake a-brief  (intake)");
    expect(lines[2]).toBe("  [answered] audience: yes");
  });

  it("shows the question itself while it is open", () => {
    const lines = intakeLines({ intake: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }) });
    expect(lines[2]).toContain("[OPEN] audience: Who reads this");
  });
});

describe("the intake store", () => {
  it("round-trips a record", () => {
    const dir = home();
    const intake = answered();
    saveIntake({ home: dir, intake });
    expect(unwrap(loadIntake({ home: dir, id: "a-brief" }))).toEqual(intake);
  });

  it("round-trips the published address, which is how a re-publish keeps its URL", () => {
    const dir = home();
    saveIntake({
      home: dir,
      intake: { ...answered(), address: NOTION_ADDRESS, status: "published" },
    });
    expect(unwrap(loadIntake({ home: dir, id: "a-brief" })).address).toStrictEqual(NOTION_ADDRESS);
  });

  it("round-trips an address on a destination other than Notion", () => {
    const dir = home();
    const address = { id: "a-brief", provider: "local" as const };
    saveIntake({ home: dir, intake: { ...answered(), address, status: "published" } });
    expect(unwrap(loadIntake({ home: dir, id: "a-brief" })).address).toStrictEqual(address);
  });

  it("round-trips a legacy URL-only record, so a re-intake never makes it look unpublished", () => {
    const dir = home();
    const intake = { ...answered(), linkOnlyPageUrl: "https://n.test/p", status: "published" as const };
    saveIntake({ home: dir, intake });
    expect(unwrap(loadIntake({ home: dir, id: "a-brief" }))).toStrictEqual(intake);
  });

  it("reports a missing intake rather than inventing one", () => {
    const dir = home();
    const loaded = loadIntake({ home: dir, id: "nothing-here" });
    expect(loaded.isErr()).toBe(true);
    expect(unwrapErr(loaded)).toStrictEqual(
      ProposalIntakeErrors.notFound({ id: "nothing-here", path: join(dir, "proposals", "nothing-here.json") }),
    );
    expect(unwrapErr(loaded).message).toBe(
      `no intake found for nothing-here (looked at ${join(dir, "proposals", "nothing-here.json")})`,
    );
  });

  it("refuses an id that would escape the state home", () => {
    const loaded = loadIntake({ home: home(), id: "../../x" });
    expect(loaded.isErr()).toBe(true);
    expect(unwrapErr(loaded).code).toBe("INTAKE_ID_INVALID");
    expect(unwrapErr(loaded).message).toBe('"../../x" is not a valid intake id, and it would reach a filename');
  });

  it("refuses a malformed question rather than dropping it, so a draft cannot proceed past it", () => {
    const dir = home();
    saveIntake({ home: dir, intake: answered() });
    writeFileSync(
      join(dir, "proposals", "a-brief.json"),
      JSON.stringify({ brief: "b", id: "a-brief", questions: [{ key: "audience" }] }),
    );
    const loaded = loadIntake({ home: dir, id: "a-brief" });
    expect(loaded.isErr()).toBe(true);
    expect(unwrapErr(loaded)).toStrictEqual(ProposalIntakeErrors.malformedQuestion({ id: "a-brief" }));
    expect(unwrapErr(loaded).message).toBe("intake a-brief has a malformed question; refusing rather than dropping it");
  });
});

describe("intakeExists", () => {
  it("is true for a record on disk, which is what tells a re-seed to merge", () => {
    const dir = home();
    saveIntake({ home: dir, intake: answered() });
    expect(intakeExists({ home: dir, id: "a-brief" })).toBe(true);
  });

  it("is true for a file that exists and CANNOT be parsed, which loadIntake alone cannot say", () => {
    const dir = home();
    saveIntake({ home: dir, intake: answered() });
    writeFileSync(join(dir, "proposals", "a-brief.json"), "{not json");
    expect(intakeExists({ home: dir, id: "a-brief" })).toBe(true);
    expect(loadIntake({ home: dir, id: "a-brief" }).isErr()).toBe(true);
    expect(unwrapErr(loadIntake({ home: dir, id: "a-brief" })).code).toBe("INTAKE_UNREADABLE");
  });

  it("is false when nothing has been seeded", () => {
    expect(intakeExists({ home: home(), id: "nothing-here" })).toBe(false);
  });

  it("is false for an id that could never have a file", () => {
    expect(intakeExists({ home: home(), id: "../../x" })).toBe(false);
  });
});

describe("parseIntake", () => {
  it("refuses a record with no questions array, which nothing could gate on", () => {
    expect(parseIntake({ raw: { brief: "b", id: "an-id" } }).isErr()).toBe(true);
    expect(unwrapErr(parseIntake({ raw: { brief: "b", id: "an-id" } })).message).toBe(
      "intake an-id has no questions array, so nothing can say whether it may advance",
    );
  });

  it("refuses something that is not an object", () => {
    expect(parseIntake({ raw: "not an intake" }).isErr()).toBe(true);
    expect(unwrapErr(parseIntake({ raw: "not an intake" }))).toStrictEqual(ProposalIntakeErrors.missingIdOrBrief());
    expect(unwrapErr(parseIntake({ raw: "not an intake" })).message).toBe("the intake file is missing its id or brief");
  });

  it("defaults an unknown status to intake rather than trusting it", () => {
    const parsed = parseIntake({ raw: { brief: "b", id: "an-id", questions: [], status: "shipped" } });
    expect(unwrap(parsed).status).toBe("intake");
  });

  it("reads a legacy pageId and pageUrl as the Notion address they always were", () => {
    const parsed = parseIntake({ raw: { ...BARE, pageId: "p-1", pageUrl: "https://n.test/p" } });
    expect(unwrap(parsed).address).toStrictEqual(NOTION_ADDRESS);
  });

  it("reads a legacy pageId with no pageUrl as a Notion address with no URL", () => {
    const parsed = parseIntake({ raw: { ...BARE, pageId: "p-1" } });
    expect(unwrap(parsed).address).toStrictEqual({ id: "p-1", provider: "notion" });
  });

  it("keeps a legacy pageUrl with no pageId for teasers only, with no address to update", () => {
    const parsed = unwrap(parseIntake({ raw: { ...BARE, pageUrl: "https://n.test/p" } }));
    expect(parsed.address).toBeUndefined();
    expect(parsed.linkOnlyPageUrl).toBe("https://n.test/p");
  });

  it("reads an EMPTY legacy pageId beside a URL as URL-only, never as a page to update", () => {
    const parsed = unwrap(parseIntake({ raw: { ...BARE, pageId: "", pageUrl: "https://n.test/p" } }));
    expect(parsed.address).toBeUndefined();
    expect(parsed.linkOnlyPageUrl).toBe("https://n.test/p");
  });

  it("refuses a legacy pageId the address schema would refuse", () => {
    const parsed = parseIntake({ raw: { ...BARE, pageId: "p 1" } });
    expect(unwrapErr(parsed)).toStrictEqual(
      ProposalIntakeErrors.addressInvalid({ id: "an-id", why: "legacy pageId: id: must not contain whitespace" }),
    );
  });

  it("refuses an address beside a legacy page field, which could name two different pages", () => {
    const parsed = parseIntake({ raw: { ...BARE, address: NOTION_ADDRESS, pageId: "p-2" } });
    expect(unwrapErr(parsed)).toStrictEqual(
      ProposalIntakeErrors.addressInvalid({ id: "an-id", why: "it carries both address and a legacy page field" }),
    );
  });

  it("refuses a malformed address rather than falling back to anything", () => {
    const parsed = parseIntake({ raw: { ...BARE, address: { id: "p-1", provider: "jira" } } });
    expect(unwrapErr(parsed).code).toBe("INTAKE_ADDRESS_INVALID");
    expect(unwrapErr(parsed).message).toContain("provider");
  });
});

describe("mergeIntake", () => {
  it("keeps every answer, which is the whole reason a re-seed is not a rewrite", () => {
    const merged = mergeIntake({
      existing: answered(),
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.questions.map((question) => question.answer)).toEqual(GAP_QUESTIONS.map(() => "yes"));
    expect(canAdvance({ intake: merged.intake })).toBe(true);
    expect(merged.keptAnswers).toBe(GAP_QUESTIONS.length);
  });

  it("keeps the instant the intake was OPENED, because a re-seed is not a new intake", () => {
    const merged = mergeIntake({
      existing: answered(),
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: new Date("2026-09-21T09:00:00.000Z") }),
    });
    expect(merged.intake.createdIso).toBe("2026-08-22T02:00:00.000Z");
  });

  it("does not walk a published intake back to intake status", () => {
    const merged = mergeIntake({
      existing: { ...answered(), status: "published" },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.status).toBe("published");
  });

  it("keeps the published address, so the next publish updates it rather than creating a second one", () => {
    const merged = mergeIntake({
      existing: { ...answered(), address: NOTION_ADDRESS, status: "published" },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.address).toStrictEqual(NOTION_ADDRESS);
  });

  it("keeps a legacy page URL, so a teaser still has something to link", () => {
    const merged = mergeIntake({
      existing: { ...answered(), linkOnlyPageUrl: "https://n.test/p", status: "published" },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.linkOnlyPageUrl).toBe("https://n.test/p");
  });

  it("updates the brief and keeps the answers, since no question is derived from the brief text", () => {
    const merged = mergeIntake({
      existing: answered(),
      fresh: deriveIntake({ brief: "a sharper brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.brief).toBe("a sharper brief");
    expect(merged.briefChanged).toBe(true);
    expect(merged.keptAnswers).toBe(GAP_QUESTIONS.length);
  });

  it("reports an unchanged brief as unchanged", () => {
    const merged = mergeIntake({
      existing: answered(),
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.briefChanged).toBe(false);
  });

  it("adds a standing question the stored record never had, unanswered", () => {
    const stored = answered();
    const merged = mergeIntake({
      existing: { ...stored, questions: stored.questions.filter((question) => question.key !== "shots") },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.addedQuestions).toBe(1);
    expect(merged.intake.questions.find((question) => question.key === "shots")!.answer).toBe(undefined);
    expect(merged.keptAnswers).toBe(GAP_QUESTIONS.length - 1);
  });

  it("carries a question the standing set no longer asks, rather than deleting the answer on it", () => {
    const stored = answered();
    const merged = mergeIntake({
      existing: {
        ...stored,
        questions: [...stored.questions, { answer: "twice a week", blocking: false, key: "cadence", question: "?" }],
      },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.carriedQuestions).toBe(1);
    const carried = merged.intake.questions.at(-1)!;
    expect(carried.key).toBe("cadence");
    expect(carried.answer).toBe("twice a week");
  });

  it("takes the standing wording for a shared key, so an improved question reaches an open intake", () => {
    const stored = answered();
    const merged = mergeIntake({
      existing: {
        ...stored,
        questions: stored.questions.map((question) => ({ ...question, question: "the old wording" })),
      },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.questions[0]!.question).toBe(GAP_QUESTIONS[0]![1]);
    expect(merged.intake.questions[0]!.answer).toBe("yes");
  });

  it("keeps a DUPLICATE of a standing key, whose answer a key-matched merge would silently eat", () => {
    const stored = deriveIntake({ brief: "a brief", id: "a-brief", now: NOW });
    const merged = mergeIntake({
      existing: {
        ...stored,
        questions: [
          stored.questions[0]!,
          { ...stored.questions[0]!, answer: "the team lead" },
          ...stored.questions.slice(1),
        ],
      },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.carriedQuestions).toBe(1);
    expect(merged.intake.questions.filter((question) => question.key === "audience").length).toBe(2);
    expect(merged.intake.questions.at(-1)!.answer).toBe("the team lead");
  });

  it("keeps a hand-set blocking:false, which the derivation writes as true on every standing question", () => {
    const stored = deriveIntake({ brief: "a brief", id: "a-brief", now: NOW });
    const merged = mergeIntake({
      existing: {
        ...stored,
        questions: stored.questions.map((question) =>
          question.key === "shots" ? { ...question, blocking: false } : { ...question, answer: "yes" },
        ),
      },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.questions.find((question) => question.key === "shots")!.blocking).toBe(false);
    expect(canAdvance({ intake: merged.intake })).toBe(true);
  });

  it("takes the id from the derivation, since that is the id saveIntake will path off", () => {
    const merged = mergeIntake({
      existing: { ...answered(), id: "a-hand-edited-id" },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.intake.id).toBe("a-brief");
  });

  it("carries a blank answer across but does not count it as kept", () => {
    const stored = answered();
    const merged = mergeIntake({
      existing: {
        ...stored,
        questions: stored.questions.map((question, index) => (index === 0 ? { ...question, answer: "  " } : question)),
      },
      fresh: deriveIntake({ brief: "a brief", id: "a-brief", now: NOW }),
    });
    expect(merged.keptAnswers).toBe(GAP_QUESTIONS.length - 1);
    expect(merged.intake.questions[0]!.answer).toBe("  ");
  });
});
