/**
 * The read half of the named-draft gate, over a real draft register in a throwaway home.
 *
 * The register is the append-only log `slack draft record` writes, so each case appends the events it needs through
 * the store's own writer and the gate folds them exactly as the release path does. The home is passed explicitly,
 * which is what `testing.md`'s ambient-home rule asks for.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent, slackDraftLogPath } from "../../../../../admit/slackDraftStore.js";
import {
  actionTexts,
  docTexts,
  namedDraftExit,
  namedDraftRefusal,
  shapeTexts,
} from "../../../../../cli/commands/handover/namedDraftAdmission.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nda-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One parked draft under `id`, its digest computed the way the recorder computes it. */
function parked({ id }: { id: string }): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: "C0SYN000002",
    mentions: [],
    payload: { form: "plain" as const, text: "heads-up", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"heads-up"}]}',
    id,
    shape: "top-level",
    tsIso: "2026-09-26T03:39:00.000Z",
    why: "the heads-up under test",
  };
}

/** Park `id`, and release it too when asked. */
function record({ id, released = false }: { id: string; released?: boolean }): void {
  unwrap(
    appendSlackDraftEvent({
      event: { draft: parked({ id }), id, kind: "parked", tsIso: "2026-09-26T03:39:00.000Z" },
      home,
    }),
  );
  if (released) {
    unwrap(
      appendSlackDraftEvent({
        event: {
          channel: "C0SYN000002",
          id,
          kind: "released",
          ts: "1790394001.000100",
          tsIso: "2026-09-26T04:00:00.000Z",
        },
        home,
      }),
    );
  }
}

function refusal({ texts }: { texts: readonly string[] }): ReturnType<typeof namedDraftRefusal> {
  return namedDraftRefusal({ command: "slopweaver handover ask", env: {}, home, texts });
}

describe("namedDraftRefusal", () => {
  it("admits a question naming a held draft", () => {
    record({ id: "sd-a0615cb5" });
    expect(refusal({ texts: ["OK to send the heads-up (draft sd-a0615cb5)?"] })).toBe(undefined);
  });

  it("refuses a question naming a draft that already went out, as a policy refusal", () => {
    record({ id: "sd-a0615cb5", released: true });
    const refused = refusal({ texts: ["OK to send the heads-up (draft sd-a0615cb5)?"] })!;
    expect(refused.code).toBe(EXIT_USAGE);
    expect(refused.lines[1]).toBe(
      "  - sd-a0615cb5 is released, so the card would ask the owner to send a draft that is no longer waiting",
    );
  });

  it("refuses a question naming a draft this home never recorded", () => {
    const refused = refusal({ texts: ["OK to send sd-12345678?"] })!;
    expect(refused.code).toBe(EXIT_USAGE);
    expect(refused.lines[1]).toBe(
      "  - sd-12345678 is not in the drafts register — a typo, or a draft never recorded on this home",
    );
  });

  it("never opens the register for a card naming no draft, even when it would not parse", () => {
    const path = slackDraftLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json\n", "utf8");
    expect(refusal({ texts: ["OK to ready #17941?"] })).toBe(undefined);
  });

  it("refuses as a failure of fact when a line it cannot read names no draft", () => {
    const path = slackDraftLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json\n", "utf8");
    const refused = refusal({ texts: ["OK to send sd-a0615cb5?"] })!;
    expect(refused.code).toBe(EXIT_ERROR);
    expect(refused.lines[0]).toBe(
      "slopweaver handover ask: it names sd-a0615cb5, and the drafts register could not be read to check them — " +
        "1 line of the as-me draft register this version cannot read passed over, with every draft they name: " +
        "line 1 (names no draft). NOTHING was recorded.",
    );
  });

  it("admits a held draft when the only line it cannot read names another draft", () => {
    record({ id: "sd-a0615cb5" });
    appendFileSync(
      slackDraftLogPath({ home }),
      `${JSON.stringify({ id: "sd-e7511638", kind: "parked", shape: "thread" })}\n`,
      "utf8",
    );
    expect(refusal({ texts: ["OK to send the heads-up (draft sd-a0615cb5)?"] })).toBe(undefined);
  });
});

describe("namedDraftExit", () => {
  it("writes every refusal line to the verb's channel and returns the refusal's exit code", () => {
    const written: string[] = [];
    const code = namedDraftExit({
      command: "slopweaver handover ask",
      env: {},
      home,
      texts: ["OK to send sd-12345678?"],
      write: (line) => {
        written.push(line);
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(written.length).toBe(3);
    expect(written[1]).toBe(
      "  - sd-12345678 is not in the drafts register — a typo, or a draft never recorded on this home",
    );
  });

  it("writes nothing and lets the verb proceed when every named draft is held", () => {
    record({ id: "sd-a0615cb5" });
    const written: string[] = [];
    const code = namedDraftExit({
      command: "slopweaver handover ask",
      env: {},
      home,
      texts: ["OK to send sd-a0615cb5?"],
      write: (line) => {
        written.push(line);
      },
    });
    expect(code).toBe(undefined);
    expect(written).toEqual([]);
  });
});

describe("shapeTexts", () => {
  const shape = {
    lean: "send it",
    options: [{ letter: "A", option: "send sd-a0615cb5", tradeoff: "the room reads it" }],
    problem: "the heads-up is held",
  };

  it("reads the problem, each option and its trade-off, the lean, then every stakes line the card draws", () => {
    const stakes = {
      blastRadius: "#delivery",
      risk: "sending sd-deadbeef pings the wrong room",
      stillReal: "draft list",
    };
    expect(shapeTexts({ shape: { ...shape, stakes } })).toEqual([
      "the heads-up is held",
      "send sd-a0615cb5",
      "the room reads it",
      "send it",
      "sending sd-deadbeef pings the wrong room",
      "#delivery",
      "draft list",
    ]);
  });

  it("stops at the lean on a row shaped before stakes were required", () => {
    expect(shapeTexts({ shape: { ...shape, stakes: undefined } })).toEqual([
      "the heads-up is held",
      "send sd-a0615cb5",
      "the room reads it",
      "send it",
    ]);
  });

  it("reads nothing when the verb was handed no shape", () => {
    expect(shapeTexts({ shape: undefined })).toEqual([]);
  });
});

describe("actionTexts", () => {
  it("reads a Slack action's body, mention names, and each destination's label, trade-off and recipients", () => {
    const action = {
      actor: "me" as const,
      body: "heads-up, see sd-deadbeef",
      destinations: [
        { channel: "C01SDLC", kind: "channel" as const, label: "Post it to #delivery", tradeoff: "loud" },
        {
          conversation: "D01",
          kind: "dm" as const,
          label: "DM Ari",
          recipients: [{ label: "Ari", userId: "U01" }],
          tradeoff: "quiet",
        },
      ],
      mentions: [{ label: "Tobias", userId: "U02" }],
      version: 1 as const,
    };
    expect(actionTexts({ action })).toEqual([
      "heads-up, see sd-deadbeef",
      "Tobias",
      "Post it to #delivery",
      "loud",
      "DM Ari",
      "quiet",
      "Ari",
    ]);
  });

  it("reads a mail's sender, every recipient, its subject and its body", () => {
    const mail = {
      actor: "me" as const,
      form: { bcc: ["x@b.c"], body: "Body", cc: ["c@b.c"], subject: "Review sd-deadbeef", to: ["a@b.c"] },
      from: "me@b.c",
      kind: "mail" as const,
      version: 2 as const,
    };
    expect(actionTexts({ action: mail })).toEqual(["me@b.c", "a@b.c", "c@b.c", "x@b.c", "Review sd-deadbeef", "Body"]);
  });

  it("reads nothing when the verb was handed no action", () => {
    expect(actionTexts({ action: undefined })).toEqual([]);
  });
});

describe("docTexts", () => {
  it("reads the slug, then the summary a linked hand card draws as its what", () => {
    expect(docTexts({ doc: { slug: "a-row", summary: "Review sd-deadbeef" } })).toEqual([
      "a-row",
      "Review sd-deadbeef",
    ]);
  });

  it("reads the slug alone off a doc stating no summary", () => {
    expect(docTexts({ doc: { slug: "a-row", summary: undefined } })).toEqual(["a-row"]);
  });
});
