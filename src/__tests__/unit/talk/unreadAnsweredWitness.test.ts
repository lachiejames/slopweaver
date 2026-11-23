/**
 * The witness for an incident on `talk unread`: the call it read printed the owner's bare yes with no question above
 * it. Over the incident's records (`../../answeredTriageHome.ts`) it now prints the voice's "Needs more info here
 * too?" and the verdict the next relay's turn stored, under the owner's words.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { UnreadArgs } from "../../../cli/commands/talk/callArgs.js";
import { fitsHost, type ResolvedRead, resolveBatch, unreadOutput } from "../../../cli/commands/talk/unreadReport.js";
import { unwrap } from "../../../lib/result.js";
import { ANSWERED_VOICE_CHARS } from "../../../talk/answerContext.js";
import { readUnreadAnswerContexts } from "../../../talk/answerContextRead.js";
import { CALL_TEXT_CHARS } from "../../../talk/callRecord.js";
import { writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor, selectUnreadWords } from "../../../talk/unreadWords.js";
import {
  ANSWERED_CALL,
  ANSWERED_OWNER_SEGMENT,
  ANSWERED_QUESTION,
  ANSWERED_QUESTION_SEGMENT,
  ANSWERED_TURN,
  ANSWERED_WORDS,
  writeAnsweredTriageHome,
} from "../../answeredTriageHome.js";

const NOW = "2026-10-14T00:00:11.000Z";

const TURN = ANSWERED_TURN;

const ARGS: UnreadArgs = {
  adopt: false,
  all: true,
  cursor: "supervisor",
  home: undefined,
  json: false,
  mark: false,
  now: NOW,
};

const OWNER_LINES = [
  `2026-10-13T23:38:47.623Z  talk-call:${ANSWERED_CALL}#${ANSWERED_OWNER_SEGMENT}  final; next ` +
    `unread relay line after it: talk:${TURN} sending at 2026-10-13T23:38:49.275Z`,
  `  " ${ANSWERED_WORDS}"`,
  `  answering the voice's "${ANSWERED_QUESTION}" (talk-call:${ANSWERED_CALL}#${ANSWERED_QUESTION_SEGMENT})`,
] as const;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The incident's records written into a throwaway home, its path padded to `length` characters when given. */
function fixtureHome({ length }: { length?: number } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "unread-answered-"));
  homes.push(root);
  const home = length === undefined ? root : join(root, "h".repeat(length - root.length - 1));
  writeAnsweredTriageHome({ home });
  return home;
}

/** `talk unread --all` over a home, resolved to the batch it prints. */
function unreadBatch({ home, args }: { home: string; args: UnreadArgs }): ResolvedRead {
  const read = unwrap(readUnread({ all: true, home, name: args.cursor, nowIso: NOW }));
  const answers = readUnreadAnswerContexts({ home, words: selectUnreadWords({ read }).words });
  return resolveBatch({ answers, args, nowIso: NOW, read, relays: [], written: undefined });
}

/** `talk unread --all` over a home, as printed. */
function unreadLines({ home, args = ARGS }: { home: string; args?: UnreadArgs }): readonly string[] {
  return unreadOutput({ args, nowIso: NOW, resolved: unreadBatch({ args, home }), written: undefined }).before;
}

/**
 * The owner's yes segment stretched to the longest a call stores, past what one batch prints — still valid — with
 * the batch before it marked read, as `talk unread --mark` records it, so the next read opens on its first part.
 */
function oversizedHome({
  args = ARGS,
  homeLength,
  question = ` ${QUESTION_TEXT}`,
  idsOf = (raw) => raw,
}: {
  args?: UnreadArgs;
  homeLength?: number;
  question?: string;
  idsOf?: (raw: string) => string;
} = {}): string {
  const home = fixtureHome(homeLength === undefined ? {} : { length: homeLength });
  const path = join(home, "talk", "calls", `${ANSWERED_CALL}.jsonl`);
  const before = readFileSync(path, "utf8");
  const text = ` ${"yes ".repeat(3_999)}yes`;
  expect(text.length).toBe(CALL_TEXT_CHARS);
  const after = before
    .replace(JSON.stringify(` ${ANSWERED_WORDS}`), JSON.stringify(text))
    .replace(JSON.stringify(` ${QUESTION_TEXT}`), JSON.stringify(question));
  const grown = ({ from, to }: { from: string; to: string }): number =>
    JSON.stringify(to).length - JSON.stringify(from).length;
  expect(after.length - before.length).toBe(
    grown({ from: ` ${ANSWERED_WORDS}`, to: text }) + grown({ from: ` ${QUESTION_TEXT}`, to: question }),
  );
  writeFileSync(path, idsOf(after));
  const first = unreadBatch({ args, home });
  expect([first.part, first.more, first.selection.words.length]).toStrictEqual([undefined, true, 0]);
  const cursor = advancedCursor({ read: first.read, recordedAtIso: NOW });
  unwrap(writeUnreadCursor({ cursor, home, name: args.cursor }));
  return home;
}

const QUESTION_LINE = OWNER_LINES[2];

const QUESTION_TEXT = ANSWERED_QUESTION;

const NOT_RECORDED =
  "triage verdict: NOT RECORDED — the relay predates stored verdicts; read row talk-a00000250000's text for one " +
  "before treating the owner's words as a yes";

const NEEDS_MORE_INFO =
  "triage verdict needs-more-info: The owner's triage verdict on this card: needs more info — find what is missing and put " +
  "it on the card.";

/** The next relay's turn as current main writes it, its needs-more-info verdict stored. */
function storeNeedsMoreInfo({ home }: { home: string }): void {
  const path = join(home, "talk", "turns", `${TURN}.json`);
  const turn = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...turn, triageRuling: { verdict: "needs-more-info" } })}\n`);
}

describe("talk unread over the bare-yes call (incident C0SYN000001)", () => {
  it("prints the voice's question under the owner's words, and the next relay's verdict as never recorded", () => {
    expect(unreadLines({ home: fixtureHome() }).slice(1)).toStrictEqual([
      "quiet batch 1: 1 stretch(es); due — the owner went quiet after 2026-10-13T23:38:47.623Z",
      ...OWNER_LINES,
      `  next relay's ${NOT_RECORDED}`,
    ]);
  });

  it("prints the needs-more-info verdict the next relay's turn stores on current main", () => {
    const home = fixtureHome();
    storeNeedsMoreInfo({ home });
    expect(unreadLines({ home }).slice(5)).toStrictEqual([`  next relay's ${NEEDS_MORE_INFO}`]);
  });

  it("prints the question under the header of a stretch too large for one batch, which prints in parts", () => {
    const lines = unreadLines({ home: oversizedHome() });
    expect(lines[0]).toContain("is too large for one batch, so it prints in parts: part 1 of 4");
    expect(lines.slice(1, 3)).toStrictEqual([QUESTION_LINE, `  past this read, the next relay's ${NOT_RECORDED}`]);
  });

  it("keeps the verdict the next relay stored on a part, named as past the read, rather than dropping it", () => {
    const home = oversizedHome();
    storeNeedsMoreInfo({ home });
    const [json] = unreadLines({ args: { ...ARGS, json: true }, home });
    const { triage, verdictOf } = (JSON.parse(json!) as { part: { answered: { triage: unknown; verdictOf: unknown } } })
      .part.answered;
    expect([unreadLines({ home })[2], triage, verdictOf]).toStrictEqual([
      `  past this read, the next relay's ${NEEDS_MORE_INFO}`,
      { kind: "stored", ruling: { verdict: "needs-more-info" } },
      "next relay, past this read",
    ]);
  });

  it("carries the question on a part in the --json report", () => {
    const [line] = unreadLines({ args: { ...ARGS, json: true }, home: oversizedHome() });
    const part = (JSON.parse(line!) as { part: { answered: unknown; index: number } }).part;
    expect([part.index, part.answered]).toStrictEqual([
      1,
      {
        triage: { kind: "not-recorded", slug: "talk-a00000250000" },
        verdictOf: "next relay, past this read",
        voice: {
          kind: "found",
          turn: {
            beganIso: "2026-10-13T23:38:26.835Z",
            pointer: "talk-call:a0000044-0000-4000-8000-000000000047#turn_000000000000000000022",
            text: QUESTION_TEXT,
          },
        },
      },
    ]);
  });

  it("keeps a --json --mark part within the host when the question before it is as long as a call stores", () => {
    const question = `${"x".repeat(CALL_TEXT_CHARS - QUESTION_TEXT.length - 1)} ${QUESTION_TEXT}`;
    expect(question.length).toBe(CALL_TEXT_CHARS);
    const args = { ...ARGS, json: true, mark: true };
    const home = oversizedHome({ question });
    const resolved = unreadBatch({ args, home });
    const output = unreadOutput({ args, nowIso: NOW, resolved, written: join(home, "talk", "unread", "supervisor") });
    const parsed = JSON.parse(output.before[0]!) as { part: { answered: { voice: { turn: { text: string } } } } };
    const quoted = parsed.part.answered.voice.turn.text;
    expect([resolved.part!.index, fitsHost({ output })]).toStrictEqual([1, true]);
    expect([quoted.length, quoted.endsWith("Needs more info here too?")]).toStrictEqual([ANSWERED_VOICE_CHARS, true]);
  });

  it("keeps a --json --mark part within the host when the quote is the costliest JSON a valid record can make", () => {
    // Control characters would escape to six bytes each and "界" is three, so the quote's tail is both; every segment
    // id is the longest a call stores (200 characters).
    const tail = "\u0001界".repeat(200);
    const question = `${"x".repeat(CALL_TEXT_CHARS - tail.length)}${tail}`;
    expect(question.length).toBe(CALL_TEXT_CHARS);
    const args = { ...ARGS, json: true, mark: true };
    const home = oversizedHome({
      idsOf: (raw) =>
        raw
          .replaceAll("turn_000000000000000000022", `turn_${"a".repeat(195)}`)
          .replaceAll("turn_000000000000000000023", `turn_${"b".repeat(195)}`),
      question,
    });
    const resolved = unreadBatch({ args, home });
    const output = unreadOutput({ args, nowIso: NOW, resolved, written: join(home, "talk", "unread", "supervisor") });
    const parsed = JSON.parse(output.before[0]!) as { part: { answered: { voice: { turn: { pointer: string } } } } };
    expect([resolved.part!.index, parsed.part.answered.voice.turn.pointer.length, fitsHost({ output })]).toStrictEqual([
      1,
      `talk-call:a0000044-0000-4000-8000-000000000047#turn_${"a".repeat(195)}`.length,
      true,
    ]);
  });

  it("keeps a --json --mark part within the host at the widest frame, with the next relay's turn unreadable", () => {
    // The costliest quote and ids above, a home and cursor name together just under 300 bytes, and a turn file that
    // does not parse, so the verdict is a reason naming that long home rather than a stored ruling's closed words.
    const tail = "\u0001界".repeat(200);
    const question = `${"x".repeat(CALL_TEXT_CHARS - tail.length)}${tail}`;
    const args = { ...ARGS, cursor: "c".repeat(64), json: true, mark: true };
    const home = oversizedHome({
      args,
      homeLength: 233,
      idsOf: (raw) =>
        raw
          .replaceAll("turn_000000000000000000022", `turn_${"a".repeat(195)}`)
          .replaceAll("turn_000000000000000000023", `turn_${"b".repeat(195)}`),
      question,
    });
    writeFileSync(join(home, "talk", "turns", `${TURN}.json`), "{");
    const resolved = unreadBatch({ args, home });
    const written = join(home, "talk", "unread", args.cursor);
    const output = unreadOutput({ args, nowIso: NOW, resolved, written });
    const parsed = JSON.parse(output.before[0]!) as { part: { answered: { triage: { kind: string; why: string } } } };
    const { triage } = parsed.part.answered;
    expect([home.length + args.cursor.length, triage.kind, triage.why.length]).toStrictEqual([
      297,
      "unreadable",
      ANSWERED_VOICE_CHARS,
    ]);
    expect([Buffer.byteLength(`${output.before[0]!}\n`), fitsHost({ output })]).toStrictEqual([7_203, true]);
  });
});
