import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  runProposalFeedback,
  runProposalList,
  runProposalShow,
} from "../../../../../cli/commands/proposal/registerRunRead.js";
import type { ProposalRegisterDeps } from "../../../../../cli/commands/proposal/registerRunShared.js";
import { unwrap } from "../../../../../lib/result.js";
import type { RegisterEvent } from "../../../../../outbound/proposal/register/events.js";
import { appendRegisterEvent } from "../../../../../outbound/proposal/register/store.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "proposal-read-"));
  homes.push(home);
  return home;
}

/** argv as the router hands it over: node, script, noun, verb, then the verb's own arguments. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", verb, ...rest];
}

/** Captured output; `now` is fixed, though these read verbs never ask for it. */
function harness(): { readonly deps: ProposalRegisterDeps; readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const now: ProposalRegisterDeps["now"] = () => new Date("2026-08-22T02:00:00.000Z");
  return { deps: { err: (line) => err.push(line), now, out: (line) => out.push(line) }, err, out };
}

/** Append each event to one slug's journal, through the production writer. */
function seed({ home, slug, events }: { home: string; slug: string; events: readonly RegisterEvent[] }): void {
  for (const event of events) {
    unwrap(appendRegisterEvent({ event, home, slug }));
  }
}

/** A `created` event for a proposal titled `title`. */
function created({ title }: { title: string }): RegisterEvent {
  return {
    atIso: "2026-08-01T00:00:00.000Z",
    kind: "created",
    address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
    source: "publish",
    title,
  };
}

describe("runProposalList", () => {
  it("lists readable entries sorted by slug and names a journal with no created event on stderr", () => {
    const home = freshHome();
    seed({ events: [created({ title: "Second" })], home, slug: "b-slug" });
    seed({
      events: [
        created({ title: "First" }),
        { atIso: "2026-08-02T00:00:00.000Z", kind: "status-changed", status: "shared", why: "x" },
      ],
      home,
      slug: "a-slug",
    });
    seed({
      events: [{ atIso: "2026-08-02T00:00:00.000Z", kind: "status-changed", status: "shared", why: "orphan" }],
      home,
      slug: "c-broken",
    });
    const h = harness();

    expect(runProposalList({ argv: argv({ rest: ["--home", home], verb: "list" }), deps: h.deps })).toBe(0);
    expect(h.out).toEqual(["a-slug  (shared)  First", "b-slug  (strawman)  Second"]);
    expect(h.err).toEqual(["c-broken: journal could not be read or holds no created event — omitted from this answer"]);
  });
});

describe("runProposalShow", () => {
  it("refuses an unregistered slug with exit 3 and names it", () => {
    const h = harness();

    expect(runProposalShow({ argv: argv({ rest: ["nope", "--home", freshHome()], verb: "show" }), deps: h.deps })).toBe(
      3,
    );
    expect(h.err).toEqual(['no proposal registered under "nope"']);
    expect(h.out).toEqual([]);
  });

  it("prints the folded detail followed by every journal event in append order with --history", () => {
    const home = freshHome();
    seed({
      events: [
        created({ title: "A proposal" }),
        { atIso: "2026-08-02T00:00:00.000Z", kind: "status-changed", status: "shared", why: "ready for eyes" },
        { atIso: "2026-08-03T00:00:00.000Z", kind: "slack-linked", permalink: "https://slack.test/p1" },
      ],
      home,
      slug: "a-slug",
    });
    const h = harness();

    expect(
      runProposalShow({ argv: argv({ rest: ["a-slug", "--history", "--home", home], verb: "show" }), deps: h.deps }),
    ).toBe(0);
    expect(h.out).toEqual([
      [
        "a-slug  (shared)",
        "title: A proposal",
        "published: https://example.test/page-1",
        "why: ready for eyes",
        "slack: https://slack.test/p1",
        "created: 2026-08-01T00:00:00.000Z",
        "updated: 2026-08-03T00:00:00.000Z",
        "source: publish",
        "history:",
        "  2026-08-01T00:00:00.000Z  created (publish) A proposal",
        "  2026-08-02T00:00:00.000Z  status → shared: ready for eyes",
        "  2026-08-03T00:00:00.000Z  slack https://slack.test/p1",
      ].join("\n"),
    ]);
    expect(h.err).toEqual([]);
  });
});

describe("runProposalFeedback", () => {
  /** Two proposals carrying owed, owed-nothing and answered feedback across three kinds. */
  function feedbackHome(): string {
    const home = freshHome();
    seed({
      events: [
        created({ title: "A" }),
        {
          atIso: "2026-08-02T00:00:00.000Z",
          feedbackKind: "acknowledgement",
          id: "f1",
          kind: "feedback-recorded",
          what: "seen",
          where: "https://slack.test/1",
          who: "Cy",
        },
        {
          atIso: "2026-08-03T00:00:00.000Z",
          feedbackKind: "pushback",
          id: "f2",
          kind: "feedback-recorded",
          what: "too costly",
          who: "Ann",
        },
        {
          atIso: "2026-08-04T00:00:00.000Z",
          feedbackKind: "question",
          id: "f3",
          kind: "feedback-recorded",
          what: "scope?",
          who: "Di",
        },
        { atIso: "2026-08-06T00:00:00.000Z", how: "replied in thread", id: "f3", kind: "feedback-answered" },
      ],
      home,
      slug: "a-slug",
    });
    seed({
      events: [
        created({ title: "B" }),
        {
          atIso: "2026-08-05T00:00:00.000Z",
          feedbackKind: "question",
          id: "f1",
          kind: "feedback-recorded",
          what: "why now?",
          who: "Bo",
        },
      ],
      home,
      slug: "b-slug",
    });
    return home;
  }

  it("lists what is owed first, pushback before question, then the rest oldest first, keeping an unanswered acknowledgement as no answer owed", () => {
    const home = feedbackHome();
    const h = harness();

    expect(runProposalFeedback({ argv: argv({ rest: ["--home", home], verb: "feedback" }), deps: h.deps })).toBe(0);
    expect(h.out).toEqual([
      "a-slug  feedback f2 (pushback) Ann: too costly — UNANSWERED",
      "b-slug  feedback f1 (question) Bo: why now? — UNANSWERED",
      "a-slug  feedback f1 (acknowledgement) Cy: seen <https://slack.test/1> — no answer owed",
      "a-slug  feedback f3 (question) Di: scope? — answered 2026-08-06T00:00:00.000Z: replied in thread",
    ]);
    expect(h.err).toEqual([]);
  });

  it("narrows to the owed rows with --unanswered, dropping the unanswered acknowledgement that owes nothing", () => {
    const home = feedbackHome();
    const h = harness();

    expect(
      runProposalFeedback({ argv: argv({ rest: ["--unanswered", "--home", home], verb: "feedback" }), deps: h.deps }),
    ).toBe(0);
    expect(h.out).toEqual([
      "a-slug  feedback f2 (pushback) Ann: too costly — UNANSWERED",
      "b-slug  feedback f1 (question) Bo: why now? — UNANSWERED",
    ]);
  });

  it("narrows to one proposal with --slug and one kind with --kind", () => {
    const home = feedbackHome();
    const h = harness();

    expect(
      runProposalFeedback({
        argv: argv({ rest: ["--slug", "a-slug", "--kind", "question", "--home", home], verb: "feedback" }),
        deps: h.deps,
      }),
    ).toBe(0);
    expect(h.out).toEqual([
      "a-slug  feedback f3 (question) Di: scope? — answered 2026-08-06T00:00:00.000Z: replied in thread",
    ]);
  });
});
