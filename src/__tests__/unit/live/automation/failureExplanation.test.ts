/**
 * The failure explanations register: one plain sentence per failed firing, keyed by slot AND attempt, refused when it
 * is the raw record pasted in, and read back with the line appended last per firing winning.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  appendFailureExplanation,
  checkExplanationWords,
  explanationKey,
  explanationsByRecipe,
  type FailureExplanation,
  readFailureExplanations,
} from "../../../../live/automation/failureExplanation.js";
import type { RecipeSlotOutcome } from "../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt } from "../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../stateHome.js";

const SLOT = "2026-11-01T09:00:00.000Z";
const LATER_SLOT = "2026-11-01T10:00:00.000Z";
const NOW = "2026-11-01T09:00:01.000Z";

/** A failed outcome, as the slot ledger settles one. */
const FAILED = {
  detail: "mail read: HTTP 401",
  exitCode: 1,
  kind: "failed",
  retryNotBeforeIso: "2026-11-01T11:00:00.000Z",
  settledAtIso: "2026-11-01T09:05:00.000Z",
} as const;

/** What taking a slot needs beyond the row and the slot. */
const TAKE = {
  holder: "recipe run-due",
  holderPid: null,
  holderToken: "token",
  leaseExpiresIso: "2026-11-02T09:00:00.000Z",
  processAlive: () => true,
};

/** Take and settle attempt 1 of the row's firing at `slotIso` with `outcome`. */
function seedFiring({ slotIso, outcome }: { slotIso: string; outcome: RecipeSlotOutcome }): void {
  const slot = { home, nowIso: NOW, recipeId: "acme-digest", slotIso };
  unwrap(beginSlotAttempt({ ...slot, ...TAKE }));
  unwrap(settleSlotAttempt({ ...slot, holderToken: TAKE.holderToken, outcome }));
}

const explanation = (over: Partial<FailureExplanation>): FailureExplanation => ({
  attempt: 1,
  recipeId: "acme-digest",
  recordedIso: "2026-11-01T09:05:00.000Z",
  slotIso: SLOT,
  why: "The mail sign-in expired, so reconnecting mail in Setup fixes it.",
  ...over,
});

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "failure-explanation-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("checkExplanationWords", () => {
  it("takes one short plain sentence, trimmed", () => {
    expect(unwrap(checkExplanationWords({ why: "  The disk is full, so freeing space fixes it.  " }))).toBe(
      "The disk is full, so freeing space fixes it.",
    );
  });

  it("refuses a quote or a bracket, naming the character, so a pasted message never rides inside one (steer 7)", () => {
    const refusals = [
      'The service answered "try again later."',
      "The token expired (it lasts a day).",
      "The service answered [try again later].",
    ].map((why) => checkExplanationWords({ why })._unsafeUnwrapErr());

    expect(refusals.map((refusal) => [refusal.fault, refusal.message.split(",")[0]])).toEqual([
      ["OUTSIDE_SHAPE", 'the explanation carries "\\""'],
      ["OUTSIDE_SHAPE", 'the explanation carries "("'],
      ["OUTSIDE_SHAPE", 'the explanation carries "["'],
    ]);
  });

  it("refuses two sentences, or one left unclosed, as not one sentence", () => {
    const refusals = [
      "The disk filled. Free some space.",
      "Did the token expire? Reconnect it.",
      "The disk filled",
      "The token expired, it lasts a day",
      "It said stop. Reconnect it!",
    ].map((why) => checkExplanationWords({ why }));

    expect(refusals.map((refusal) => refusal._unsafeUnwrapErr().fault)).toEqual([
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
    ]);
    expect(refusals[0]!._unsafeUnwrapErr().message).toContain("is not one sentence ending in a full stop");
  });

  it("refuses two sentences run together with no space between them", () => {
    const refusals = [
      "It broke.It needs reconnecting.",
      "It broke!It needs reconnecting.",
      "Did it expire?Reconnect it.",
      "It said stop!Reconnect it.",
      "It broke.reconnect it.",
      "The mail.example.com host stopped answering, so checking its network fixes it.",
    ].map((why) => checkExplanationWords({ why }));

    expect(refusals.map((refusal) => refusal._unsafeUnwrapErr().fault)).toEqual([
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
      "NOT_ONE_SENTENCE",
    ]);
  });

  it("takes a full stop between digits, a question, and a sentence in any script, as one sentence", () => {
    const kept = [
      "Version 2.4 dropped the old sign-in, so reconnecting it fixes it.",
      "Did the mail sign-in expire overnight?",
      "The bot's token isn’t valid any more, so re-run the sign-in.",
      "Le jeton a expiré, donc il faut le reconnecter.",
      "Токен истёк, поэтому его нужно переподключить.",
      // A count in passing and a hyphenated word are not codes.
      "Slack sent back 500 messages it could not store, so the sync stopped part way.",
      "The sign-in expired, so reconnecting it fixes it.",
      // A clock time has a line-and-column shape but no path, so it is words.
      "It stopped at 09:00:00 and never resumed.",
      // A dotted version beside a time is no file and line.
      "Version 2.4 ran at 9:30 and stopped.",
      // A lowercase warning is a word; only the capitalised class word is residue.
      "The sync ignored a warning about the old token.",
    ];

    expect(kept.map((why) => unwrap(checkExplanationWords({ why })))).toEqual(kept);
  });

  it("refuses an empty, multi-line or over-long sentence, naming which", () => {
    const refusals = ["   ", "first line\nsecond line", "x".repeat(201)].map((why) =>
      checkExplanationWords({ why })._unsafeUnwrapErr(),
    );

    expect(refusals.map((refusal) => [refusal.fault, refusal.message.split(":")[0]])).toEqual([
      ["EMPTY", "the explanation is empty"],
      ["MULTI_LINE", "the explanation spans more than one line"],
      ["TOO_LONG", "the explanation is 201 characters, over the 200 a row's subtitle holds"],
    ]);
  });

  it("counts a letter outside the Basic Multilingual Plane as one character against the cap", () => {
    const astral = `${"\u{10400}".repeat(199)}.`;

    expect(unwrap(checkExplanationWords({ why: astral }))).toBe(astral);
    expect(checkExplanationWords({ why: `${"\u{10400}".repeat(200)}.` })._unsafeUnwrapErr().fault).toBe("TOO_LONG");
  });

  it("counts every combining mark against the cap, so one stacked letter cannot pass as one character", () => {
    expect(checkExplanationWords({ why: `a${"́".repeat(200)}.` })._unsafeUnwrapErr().fault).toBe("TOO_LONG");
  });

  it("refuses every runtime's raw record by its shape, the grammars no list named included (steer 7)", () => {
    const pasted = [
      // The four grammars the denylist never named: Go, Rust, Java and Ruby.
      "panic: runtime error: index out of range [5] with length 3.",
      "thread 'main' panicked at src/main.rs:2:5.",
      "Exception in thread main java.lang.NullPointerException at com.acme.Foo.bar(Foo.java:12).",
      "from /app/sync.rb:12:in 'run'.",
      // A .NET frame, a PHP fatal and a Go goroutine header, none of which any branch ever named.
      "at Acme.Sync.Run() in C:\\src\\Sync.cs:line 42.",
      "PHP Fatal error:  Uncaught exception in /var/www/x.php on line 3.",
      "goroutine 1 [running], main.main() stopped.",
      // Every shape the denylist did name: frames, JSON, codes, envelopes, a status line, a page.
      "TypeError: boom at readBoard (/repo/src/board.ts:12:3)",
      'it said {"ok":false}',
      '{ "error": "bad" }',
      "The response body was [null].",
      "Cannot read properties of undefined (reading 'map').",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package x.",
      "The sync stopped on ERR_STREAM_PREMATURE_CLOSE.",
      "invalid_auth.",
      "INVALID_AUTH.",
      "It threw at <anonymous> on start.",
      "It threw at node:internal/modules/run_main:122:12 on start.",
      "Traceback (most recent call last): ValueError: boom.",
      'File "/repo/sync.py", line 3, in main.',
      "HTTP/1.1 418 I'm a teapot.",
      "The page answered <!doctype html> instead.",
      "It threw AT Array.map (NATIVE) on start.",
      "The command failed: Error: connection closed.",
      // A quote made of apostrophes is outside the words grammar, though each character is allowed.
      "Rust said 'main' panicked, so the run stopped.",
      // A word mixing letters and digits names no word: an errno, a class or a signal carrying a digit.
      "E2BIG.",
      "HTTP2Error opened the session.",
    ].map((why) => checkExplanationWords({ why }));

    expect(pasted.map((refusal) => refusal._unsafeUnwrapErr().fault)).toEqual(pasted.map(() => "OUTSIDE_SHAPE"));
    expect(pasted.map((refusal) => refusal._unsafeUnwrapErr().message.split(",")[0]).slice(0, 4)).toEqual([
      'the explanation carries ":"',
      'the explanation carries "/"',
      'the explanation carries "("',
      'the explanation carries "/"',
    ]);
    expect(pasted.at(-1)!._unsafeUnwrapErr().message.split(",")[0]).toBe(
      "the explanation carries a word or number out of shape",
    );
  });

  it("refuses the raw records the old denylist let through, since none was a grammar it named (steer 7)", () => {
    const slipped = [
      "The sync failed on panic: runtime error, index out of range.",
      "** (ArithmeticError) bad argument in arithmetic expression.",
      "The sync failed with KeyError 'user'.",
      "Rust said 'main' panicked, so the run stopped.",
    ].map((why) => checkExplanationWords({ why }).isErr());

    expect(slipped).toEqual([true, true, true, true]);
  });

  it("refuses the raw records made of words alone, the residue the shape still lets through", () => {
    const worded = [
      "the verb exited 1",
      "TypeError foo.",
      "The read stopped on a NullPointerException.",
      "Error reading the board stopped the sync.",
      // A built-in class not named for an error.
      "The runtime raised KeyboardInterrupt.",
      "The worker ended on SystemExit.",
      "It stopped with StopIteration.",
      // A class word with more CamelCase after its Error or Exception, and a warning class.
      "The runtime raised ExceptionGroup.",
      "The runtime raised BaseExceptionGroup.",
      "The import raised DeprecationWarning.",
      "The runtime raised Warning.",
      // A boundary or digit outside ASCII, which JavaScript's own `\b` and `\d` do not see.
      "The runtime raised ΔWarning.",
      // A combining mark, written decomposed, inside a class word.
      "The runtime raised CaféError.",
      "The runtime raised CaféWarning.",
      "The runtime raised ErrorCafé.",
      "The runtime raised ErrórGroup.",
      "The runtime raised ErroŕGroup.",
      // A titlecase or caseless letter running the class word on.
      "The runtime raised Errorǅuro.",
      "The runtime raised ExceptionΔ.",
      "The runtime raised Error日本.",
      "The runtime raised ÉrrorGroup.",
      "The runtime raised Érror.",
      "The service returned ٤٠١.",
      "Сервис вернул status 503.",
      "ENOENT.",
      "ETIMEDOUT.",
      // A three-letter errno, under the capitals branch's floor.
      "EIO.",
      "The disk read failed with eio.",
      "SIGTERM.",
      "503.",
      "HTTP 401 Unauthorized.",
      "The service answered status 503.",
      "It got a 429 Too Many Requests.",
      "The service returned 401.",
      "The service returned status code 401.",
      // A comma the shape allows between the verb or status word and the number.
      "The service returned, 401.",
      "It got a 503, error, so it stopped.",
      "The verb exited، 1.",
      // The number a few words after the status word.
      "The service returned a status of 401.",
      "Its HTTP response was 503.",
      "The status it sent was 429.",
      "Linear gave a 503 error, so the read stopped.",
      "The command failed with exit code 1.",
      "It exited with status 2.",
      "Traceback most recent call last came back.",
      "It said cannot read properties of undefined.",
      "The body was an unexpected token in the response.",
      "The stack hit maximum call stack size exceeded.",
      // Each in another casing, the class rather than one more spelling.
      "http 401.",
      "statuscode 503.",
      "401 unauthorized.",
      "etimedout.",
      "It stopped on sigterm.",
      "The service RETURNED 401.",
      "It GOT A 503, so the read stopped.",
      "The verb EXITED 1.",
    ].map((why) => checkExplanationWords({ why }));
    const raw = "the explanation reads like the raw record (a stack frame, a JSON body, an exception or an exit code)";

    expect(worded.map((refusal) => refusal._unsafeUnwrapErr().fault)).toEqual(worded.map(() => "RAW_RECORD"));
    expect(worded.map((refusal) => refusal._unsafeUnwrapErr().message.split(":")[0])).toEqual(worded.map(() => raw));
  });

  it("refuses a sentence whose characters fit but whose words do not, as outside the shape", () => {
    const refusals = [
      "The token expired  overnight.",
      "The token expired,, so reconnect it.",
      "The token - it expired.",
      "-The token expired.",
      "The token expired, .",
      // A word opening on a combining mark is no word, though a mark is an allowed character.
      "The ́token expired.",
    ].map((why) => checkExplanationWords({ why })._unsafeUnwrapErr().fault);

    expect(refusals).toEqual(refusals.map(() => "OUTSIDE_SHAPE"));
  });

  it("names a tab, a semicolon, a dash, an emoji or a middle dot as outside the shape", () => {
    const named = [
      "The token\texpired.",
      "The service failed; reconnect it.",
      "The service failed — reconnect it.",
      "The service failed 🔥.",
      "The service failed · reconnect it.",
    ].map((why) => checkExplanationWords({ why })._unsafeUnwrapErr().message.split(",")[0]);

    expect(named).toEqual([
      'the explanation carries "\\t"',
      'the explanation carries ";"',
      'the explanation carries "—"',
      'the explanation carries "🔥"',
      'the explanation carries "·"',
    ]);
  });

  it("takes a sentence closed by its own script's stop, with its own script's comma", () => {
    const kept = [
      "メールのサインインが期限切れです。",
      "令牌已过期，请重新连接。",
      "هل انتهت صلاحية الرمز؟",
      "टोकन की अवधि समाप्त हो गई।",
      // A version in its own script's digits, whose point is no stop.
      "الإصدار ٢.٤ توقف.",
      "संस्करण २.४ रुक गया।",
      // A script written without spaces, where a number meets its word directly.
      "バージョン２.４が停止しました。",
      "同步在3点失败了。",
      "เวอร์ชัน2.4หยุดทำงาน.",
    ];

    expect(kept.map((why) => unwrap(checkExplanationWords({ why })))).toEqual(kept);
    expect(checkExplanationWords({ why: "期限切れです。再接続してください。" })._unsafeUnwrapErr().fault).toBe(
      "NOT_ONE_SENTENCE",
    );
  });

  it("takes a word with several joiners, and one carrying a combining mark", () => {
    const kept = [
      "The end-to-end sync failed, so re-run it.",
      "It shouldn't've retried.",
      "The mail-service's token expired.",
      "The café calendar stopped.",
      // A product name in CamelCase is a word, not a class.
      "The GitHub token expired, so OAuth needs reconnecting.",
    ];

    expect(kept.map((why) => unwrap(checkExplanationWords({ why })))).toEqual(kept);
  });

  it("takes a capitalised word that only starts like an errno or a signal", () => {
    const kept = [
      "EVERY retry failed.",
      "The EXPORT stopped, so SIGNAL a rerun.",
      "Errors stopped the run, so it retried.",
    ];

    expect(kept.map((why) => unwrap(checkExplanationWords({ why })))).toEqual(kept);
  });
});

describe("the register", () => {
  it("reads a missing register as empty", () => {
    expect(unwrap(readFailureExplanations({ home }))).toEqual({ explanations: [], unparsed: [] });
  });

  it("refuses a register that is a dangling link, rather than reading it as empty", () => {
    const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(join(home, "gone.jsonl"), path);

    const read = readFailureExplanations({ home });

    expect(read._unsafeUnwrapErr().code).toBe("EXPLANATIONS_FILE_UNREADABLE");
  });

  it("round-trips what it appends, and counts a torn line rather than failing the read", () => {
    seedFiring({ outcome: FAILED, slotIso: SLOT });
    seedFiring({ outcome: { ...FAILED, kind: "dead", reason: "HOLDER_GONE" }, slotIso: LATER_SLOT });
    unwrap(appendFailureExplanation({ explanation: explanation({}), home }));
    appendFileSync(stateHomePaths({ home }).live.recipe.failureExplanationsJsonl, "{torn\n");
    unwrap(appendFailureExplanation({ explanation: explanation({ slotIso: LATER_SLOT }), home }));

    expect(unwrap(readFailureExplanations({ home }))).toEqual({
      explanations: [explanation({}), explanation({ slotIso: LATER_SLOT })],
      unparsed: [2],
    });
  });

  it("refuses, whoever calls it, a sentence for a firing the slot ledger does not hold as failed or dead", () => {
    seedFiring({
      outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-11-01T09:05:00.000Z" },
      slotIso: SLOT,
    });
    seedFiring({ outcome: FAILED, slotIso: LATER_SLOT });
    const opened = "2026-11-01T11:00:00.000Z";
    unwrap(beginSlotAttempt({ ...TAKE, home, nowIso: NOW, recipeId: "acme-digest", slotIso: opened }));

    const refused = [
      explanation({}),
      explanation({ slotIso: opened }),
      explanation({ attempt: 2, slotIso: LATER_SLOT }),
      explanation({ slotIso: "2026-11-01T12:00:00.000Z" }),
    ].map((one) => appendFailureExplanation({ explanation: one, home })._unsafeUnwrapErr().message);

    expect(refused).toEqual([
      `acme-digest's firing at ${SLOT} attempt 1 is succeeded, not a failure, so no explanation is filed`,
      `acme-digest's firing at ${opened} attempt 1 is still open, not a failure, so no explanation is filed`,
      `acme-digest's firing at ${LATER_SLOT} attempt 2 is not the slot's recorded attempt (1), not a failure, so no explanation is filed`,
      "acme-digest's firing at 2026-11-01T12:00:00.000Z attempt 1 is not recorded, not a failure, so no explanation is filed",
    ]);
    expect(unwrap(readFailureExplanations({ home }))).toEqual({ explanations: [], unparsed: [] });
  });

  it("refuses, whoever calls it, words that are not one plain sentence, and files an accepted one trimmed", () => {
    seedFiring({ outcome: FAILED, slotIso: SLOT });

    const refused = appendFailureExplanation({
      explanation: explanation({ why: "TypeError: boom\n    at readBoard (/repo/src/board.ts:12:3)" }),
      home,
    })._unsafeUnwrapErr();
    const spaced = appendFailureExplanation({
      explanation: explanation({ why: '{ "error": "bad" }' }),
      home,
    })._unsafeUnwrapErr();
    unwrap(
      appendFailureExplanation({ explanation: explanation({ why: "  The mail sign-in was turned down.  " }), home }),
    );

    expect([refused.code, refused.message, spaced.message]).toEqual([
      "EXPLANATION_WORDS_REFUSED",
      "acme-digest's explanation was not filed: the explanation spans more than one line: one sentence, with the raw record left in the firing",
      'acme-digest\'s explanation was not filed: the explanation carries "{", which a plain sentence here does not: words and numbers one space apart, joined only by an apostrophe or hyphen, with commas and one closing stop, so say a code, a path, a quote or a bracket in words',
    ]);
    expect(unwrap(readFailureExplanations({ home }))).toEqual({
      explanations: [explanation({ why: "The mail sign-in was turned down." })],
      unparsed: [],
    });
  });

  it("counts a well-formed line whose sentence is a raw record as unparsed, so it never leads a row", () => {
    const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    const lines = [
      explanation({ why: '{"error":"invalid_grant"}' }),
      explanation({ why: "first line\nsecond line" }),
      explanation({ why: "The mail sign-in expired." }),
      explanation({ why: "TypeError: Cannot read properties of undefined" }),
      explanation({ why: '{ "error": "bad" }' }),
    ].map((one) => `${JSON.stringify(one)}\n`);
    appendFileSync(path, lines.join(""));

    expect(unwrap(readFailureExplanations({ home }))).toEqual({
      explanations: [explanation({ why: "The mail sign-in expired." })],
      unparsed: [1, 2, 4, 5],
    });
  });

  it("counts a line whose recording time is not one instant as unparsed, so it never outranks a valid one", () => {
    const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    const lines = [
      explanation({ why: "The mail sign-in expired." }),
      explanation({ recordedIso: "not-an-instant", why: "A later line with no real time." }),
      explanation({ recordedIso: "2026-11-01", why: "A date with no time." }),
      // A correction whose firing key is not one instant keys no firing, so it too stands the register down.
      explanation({ slotIso: "not-an-instant", why: "A correction under a torn slot." }),
    ].map((one) => `${JSON.stringify(one)}\n`);
    appendFileSync(path, lines.join(""));

    expect(unwrap(readFailureExplanations({ home }))).toEqual({
      explanations: [explanation({ why: "The mail sign-in expired." })],
      unparsed: [2, 3, 4],
    });
  });

  it("refuses to append an explanation whose recording time is not one instant, writing nothing", () => {
    seedFiring({ outcome: FAILED, slotIso: SLOT });

    const written = appendFailureExplanation({ explanation: explanation({ recordedIso: "not-an-instant" }), home });

    expect([written._unsafeUnwrapErr().message, unwrap(readFailureExplanations({ home }))]).toEqual([
      "acme-digest's explanation was not filed: its recording time not-an-instant is not one ISO instant",
      { explanations: [], unparsed: [] },
    ]);
  });

  it("counts a line holding a byte that is not UTF-8 as unparsed, never its repaired sentence", () => {
    const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    const [before, after] = `${JSON.stringify(explanation({ why: "The token expXired." }))}\n`.split("X");
    appendFileSync(path, Buffer.concat([Buffer.from(before!), Buffer.from([0xff]), Buffer.from(after!)]));

    expect(unwrap(readFailureExplanations({ home }))).toEqual({ explanations: [], unparsed: [1] });
  });

  it("says which register it could not append to", () => {
    seedFiring({ outcome: FAILED, slotIso: SLOT });
    const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    // A directory where the register's file goes makes the append fail without touching anything else.
    mkdirSync(path, { recursive: true });

    const written = appendFailureExplanation({ explanation: explanation({}), home });

    expect(written._unsafeUnwrapErr()).toMatchObject({ code: "EXPLANATIONS_FILE_UNWRITABLE", path });
  });
});

describe("explanationsByRecipe", () => {
  it("files each sentence under its recipe and exact firing, the line appended last per firing winning", () => {
    const byRecipe = explanationsByRecipe({
      explanations: [
        explanation({ why: "First word." }),
        explanation({ recordedIso: "2026-11-01T09:10:00.000Z", why: "Corrected word." }),
        explanation({ attempt: 2, why: "The retry failed differently." }),
        explanation({ recipeId: "acme-sync", why: "Another row." }),
      ],
    });

    expect([
      byRecipe.get("acme-digest")!.get(explanationKey({ attempt: 1, slotIso: SLOT })),
      byRecipe.get("acme-digest")!.get(explanationKey({ attempt: 2, slotIso: SLOT })),
      byRecipe.get("acme-sync")!.get(explanationKey({ attempt: 1, slotIso: SLOT })),
      byRecipe.get("acme-digest")!.size,
    ]).toEqual(["Corrected word.", "The retry failed differently.", "Another row.", 2]);
  });

  it("lets a later line win a tie on its instant", () => {
    const byRecipe = explanationsByRecipe({
      explanations: [explanation({ why: "Earlier line." }), explanation({ why: "Later line." })],
    });

    expect(byRecipe.get("acme-digest")!.get(`${SLOT}#1`)).toBe("Later line.");
  });

  it("lets the line appended last win even when its clock reads earlier, so a correction never loses", () => {
    const byRecipe = explanationsByRecipe({
      explanations: [
        explanation({ recordedIso: "2026-11-01T09:10:00.000Z", why: "Wrong words." }),
        explanation({ recordedIso: "2026-11-01T09:00:00.000Z", why: "Corrected words." }),
      ],
    });

    expect(byRecipe.get("acme-digest")!.get(`${SLOT}#1`)).toBe("Corrected words.");
  });
});
