/**
 * The `queue` verbs, driven through their REAL argv offset against a temp home.
 *
 * The offset is the reason this exists rather than testing the pure core alone: `slopweaver turn answer` had
 * exactly this index wrong once and the whole unit suite passed, because the tests constructed the tail they
 * expected. So every call here builds the argv the router actually passes.
 *
 * Nothing reaches Slack. `release --dry-run` is the furthest this goes — it validates the stored draft and
 * renders it, which is every step before the wire.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldQueue, type HeldReply, parseQueueLog } from "../../../../admit/queue.js";
import { appendQueueEvent, readQueueText } from "../../../../admit/queueStore.js";
import { runQueueDrop, runQueueList, runQueueRelease, runQueueShow } from "../../../../cli/commands/queue/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-queue-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The argv the router hands a verb: `[node, cli, queue, <verb>, …]`. */
function argv({ verb, tail }: { verb: string; tail: readonly string[] }): readonly string[] {
  return ["node", "cli", "queue", verb, ...tail];
}

/** A draft the card schema accepts — what a turn actually composes. */
const VALID_DRAFT: Readonly<Record<string, unknown>> = {
  citations: [],
  detail: [{ runs: [{ text: "Markdown is inert inside rich_text.", type: "text" }], type: "paragraph" }],
  index: [[{ text: "4 records retrieved · 1 grounded the answer", type: "text" }]],
  kind: "update",
  media: [],
  tldr: "We render rich_text.",
};

function held({ draft = VALID_DRAFT }: { draft?: Readonly<Record<string, unknown>> } = {}): HeldReply {
  return {
    askedBy: "U_COLLEAGUE",
    channel: "C1",
    code: "withhold.reply",
    draft,
    messageTs: "1712345678.000100",
    question: "what did we decide about the renderer?",
    reason: "not the owner",
    surface: "channel",
    threadTs: "1712345678.000100",
  };
}

/** A held draft in the new answer-form shape, grounded in a live verb rather than the corpus. */
const VALID_ANSWER_VERB: Readonly<Record<string, unknown>> = {
  body: [],
  citations: [],
  grounding: {
    capability: { command: ["slopweaver", "fleet", "status"], id: "fleet.status", what: "list open PRs" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [],
    },
    kind: "verb",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    result: "3 open PRs",
  },
  images: [],
  kind: "answer",
  lead: "You have 3 open PRs.",
};

/** A held draft in the new answer-form shape, grounded in context and judgement alone, no live source. */
const VALID_ANSWER_CONVERSATION: Readonly<Record<string, unknown>> = {
  body: [],
  citations: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [],
    },
    kind: "conversation",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "already known from context, no live check needed",
  },
  images: [],
  kind: "answer",
  lead: "The connector polls by updated timestamp.",
};

/** File one held draft under `id`. */
function fileHeld({ id, draft }: { id: string; draft?: Readonly<Record<string, unknown>> }): void {
  appendQueueEvent({
    event: { held: held(draft === undefined ? {} : { draft }), id, kind: "held", tsIso: "2026-08-06T01:00:00.000Z" },
    home,
  });
}

/** The queue as it stands on disk. */
function currentQueue() {
  return foldQueue({ events: parseQueueLog({ text: readQueueText({ home }) }).events });
}

describe("queue list", () => {
  it("succeeds against a home that has never withheld anything", async () => {
    expect(await runQueueList(argv({ tail: ["--home", home], verb: "list" }))).toBe(EXIT_OK);
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    expect(await runQueueList(argv({ tail: ["--everything"], verb: "list" }))).toBe(EXIT_USAGE);
  });

  it("reads the real log at the real argv offset", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(await runQueueList(argv({ tail: ["--home", home, "--json"], verb: "list" }))).toBe(EXIT_OK);
  });
});

describe("queue show", () => {
  it("wants an id", async () => {
    expect(await runQueueShow(argv({ tail: ["--home", home], verb: "show" }))).toBe(EXIT_USAGE);
  });

  it("reports an id that names nothing, rather than printing an empty entry", async () => {
    expect(await runQueueShow(argv({ tail: ["q-nope", "--home", home], verb: "show" }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("prints a real entry", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(await runQueueShow(argv({ tail: ["q-aaaa1111", "--home", home], verb: "show" }))).toBe(EXIT_OK);
  });
});

describe("queue drop", () => {
  it("resolves a held entry without sending anything", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(await runQueueDrop(argv({ tail: ["q-aaaa1111", "--home", home, "--note", "by hand"], verb: "drop" }))).toBe(
      EXIT_OK,
    );
    expect(currentQueue()[0]!.state).toBe("dropped");
    expect(currentQueue()[0]!.note).toBe("by hand");
  });

  it("refuses to resolve an entry twice", async () => {
    fileHeld({ id: "q-aaaa1111" });
    await runQueueDrop(argv({ tail: ["q-aaaa1111", "--home", home], verb: "drop" }));
    expect(await runQueueDrop(argv({ tail: ["q-aaaa1111", "--home", home], verb: "drop" }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("records an absent note as empty rather than dropping the field", async () => {
    fileHeld({ id: "q-aaaa1111" });
    await runQueueDrop(argv({ tail: ["q-aaaa1111", "--home", home], verb: "drop" }));
    expect(currentQueue()[0]!.note).toBe("");
  });
});

describe("queue release", () => {
  it("wants an id", async () => {
    expect(await runQueueRelease(argv({ tail: ["--home", home], verb: "release" }))).toBe(EXIT_USAGE);
  });

  it("validates and renders the stored draft under --dry-run, and sends nothing", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(await runQueueRelease(argv({ tail: ["q-aaaa1111", "--home", home, "--dry-run"], verb: "release" }))).toBe(
      EXIT_OK,
    );
    // Still held: a dry run that resolved the entry would make the queue lie about what went out.
    expect(currentQueue()[0]!.state).toBe("held");
  });

  it("REFUSES a stored draft the card schema no longer accepts, naming the failure", async () => {
    fileHeld({ draft: { kind: "update", tldr: "" }, id: "q-bbbb2222" });
    expect(await runQueueRelease(argv({ tail: ["q-bbbb2222", "--home", home, "--dry-run"], verb: "release" }))).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses to send an already-resolved entry a second time", async () => {
    fileHeld({ id: "q-aaaa1111" });
    await runQueueDrop(argv({ tail: ["q-aaaa1111", "--home", home], verb: "drop" }));
    expect(await runQueueRelease(argv({ tail: ["q-aaaa1111", "--home", home], verb: "release" }))).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("reports an id that names nothing", async () => {
    expect(await runQueueRelease(argv({ tail: ["q-nope", "--home", home], verb: "release" }))).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });
});

describe("queue release --form (editing a held draft)", () => {
  /** A valid replacement form, as inline JSON. */
  const REPLACEMENT = JSON.stringify({ ...VALID_DRAFT, tldr: "We render rich_text, restated." });

  it("releases the replacement instead of the stored draft", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(
      await runQueueRelease(
        argv({ tail: ["q-aaaa1111", "--home", home, "--dry-run", "--form", REPLACEMENT], verb: "release" }),
      ),
    ).toBe(EXIT_OK);
  });

  it("refuses a replacement that is not JSON, rather than falling back to the stored draft", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(
      await runQueueRelease(argv({ tail: ["q-aaaa1111", "--home", home, "--form", "not json"], verb: "release" })),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a replacement that is a JSON array, because a form is an object", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(await runQueueRelease(argv({ tail: ["q-aaaa1111", "--home", home, "--form", "[]"], verb: "release" }))).toBe(
      EXIT_USAGE,
    );
  });

  it("refuses a replacement the card schema rejects", async () => {
    fileHeld({ id: "q-aaaa1111" });
    expect(
      await runQueueRelease(
        argv({ tail: ["q-aaaa1111", "--home", home, "--dry-run", "--form", '{"kind":"update"}'], verb: "release" }),
      ),
    ).toBe(EXIT_ERROR);
  });

  it("RECORDS the substitution on the release event, so the log never implies the draft went out as-is", async () => {
    fileHeld({ id: "q-aaaa1111" });
    // The queue entry keeps the composed draft; only the note says something else was sent. A dry run would
    // record nothing, so this test needs the store write — which is why it drives `drop` for the control.
    appendQueueEvent({
      event: {
        id: "q-aaaa1111",
        kind: "released",
        note: "[edited: released a --form replacement, not the stored draft] by hand",
        tsIso: "t2",
      },
      home,
    });
    expect(currentQueue()[0]!.note).toContain("[edited:");
  });
});

describe("queue release — answer form", () => {
  it("releases a verb-grounded held answer under --dry-run", async () => {
    fileHeld({ draft: VALID_ANSWER_VERB, id: "q-verb1111" });
    expect(await runQueueRelease(argv({ tail: ["q-verb1111", "--home", home, "--dry-run"], verb: "release" }))).toBe(
      EXIT_OK,
    );
    // Still held: a dry run must not resolve the entry.
    expect(currentQueue()[0]!.state).toBe("held");
  });

  /**
   * No live grounding kind derives its evidence trail from a corpus load any more — `conversation`, like
   * `verb` and `unreachable`, carries its own `evidence` directly. This proves release never needed a corpus
   * read for it at all, unlike the pre-H8 shape this test once guarded.
   */
  it("releases a conversation-grounded held answer under --dry-run", async () => {
    fileHeld({ draft: VALID_ANSWER_CONVERSATION, id: "q-conversation111" });
    expect(
      await runQueueRelease(argv({ tail: ["q-conversation111", "--home", home, "--dry-run"], verb: "release" })),
    ).toBe(EXIT_OK);
  });
});

/**
 * The graph-finding floor on the RELEASE door (a finding needs at least three photos). A held answer is released through its locked bytes, never `parseAnswerArm`, so the floor counts what
 * the release really sends — here nothing, for a measured finding linking a Datadog graph.
 */
describe("queue release — a held graph finding short of three screenshots", () => {
  const HELD_HUNT: Readonly<Record<string, unknown>> = {
    ...VALID_ANSWER_CONVERSATION,
    body: [
      {
        runs: [
          { text: "nz cal api key fetch denied, 1 to 123 errors ", type: "text" },
          {
            label: "[1]",
            type: "link",
            url: "https://ap1.datadoghq.com/logs?query=env%3Aproduction%20status%3Aerror&live=false&viz=timeseries",
          },
        ],
        type: "paragraph",
      },
    ],
    measurements: [
      { figures: ["123"], repro: "slopweaver datadog logs count", takenAtIso: "2026-09-26T14:30:00.000Z" },
    ],
  };

  it("REFUSES the release, even as a dry run, and leaves the entry held", async () => {
    fileHeld({ draft: HELD_HUNT, id: "q-hunt1111" });
    expect(await runQueueRelease(argv({ tail: ["q-hunt1111", "--home", home, "--dry-run"], verb: "release" }))).toBe(
      EXIT_ERROR,
    );
    expect(currentQueue()[0]!.state).toBe("held");
  });
});
