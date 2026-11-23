/**
 * The three edits a refresh pass makes to a registered ask that never opened a run, over the exact bytes
 * `handover register` writes. The measured failure: every such card refused reconfirm, correct and
 * withdraw with "no run is open — start it first", and starting one takes the card off the owner's Queue.
 */
// The pronoun-heading case went out with the matcher that read it.
// deleted-with-code: PRONOUN_ASK_HEADING
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { askRowText } from "../../../cli/commands/handover/askRowText.js";
import { briefText } from "../../../handover/briefPaths.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { registeredAskChangeText, registeredAskForChange } from "../../../handover/registeredAskChange.js";
import { RegisteredAskChangeErrors } from "../../../handover/registeredAskChangeErrors.js";

const PATH = "/h/a-registered-ask.md";
const ASKED = "2026-10-10T17:01:55.569Z";
const QUESTION = "Should more console sidebar entries carry a count?";
const CHECK = "Shell.tsx still has eight sidebar entries";

/** The row exactly as `handover register` writes a whole-shaped ask. */
const REGISTERED = askRowText({
  anchor: undefined,
  ask: QUESTION,
  askedIso: ASKED,
  branch: undefined,
  checkedIso: ASKED,
  dispatch: false,
  finding: undefined,
  priority: "p1",
  repo: "/w/repo",
  shape: {
    lean: "A",
    options: [
      { letter: "A", option: "count the automations page", tradeoff: "it reads 34 today" },
      { letter: "B", option: "count nothing else", tradeoff: "a failure stays invisible" },
    ],
    problem: "only Queue and Pull requests carry a count",
    stakes: { blastRadius: "the console sidebar", risk: "a count nobody acts on", stillReal: CHECK },
  },
  slug: "a-registered-ask",
});

const STARTED: RunEvent = { atIso: "2026-10-11T00:00:00.000Z", branch: "b", docHash: "abc", kind: "started" };

/** The row as the board parses it. */
function parsed({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> {
  return parseHandoverDoc({ path: PATH, text });
}

describe("registeredAskForChange", () => {
  it("answers the Queue's own registered ask for a row no run has opened", () => {
    const doc = parsed({ text: REGISTERED });

    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: false, unreadableLines: [] })).toEqual({
      askedIso: ASKED,
      question: QUESTION,
    });
  });

  it("answers nothing once a run has opened, so the journal path keeps the row", () => {
    const doc = parsed({ text: REGISTERED });

    expect(registeredAskForChange({ doc, events: [STARTED], rewritesStillReal: false, unreadableLines: [] })).toBe(
      undefined,
    );
  });

  it("answers nothing over a journal line this checkout cannot read", () => {
    const doc = parsed({ text: REGISTERED });

    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: false, unreadableLines: [3] })).toBe(undefined);
  });

  it("answers nothing for a malformed row, so the run path keeps its refusal", () => {
    const doc = parsed({ text: REGISTERED.replace("\npriority: p1\n", "\npriority: p1\npriority: p2\n") });

    expect(doc.problems.length).toBeGreaterThan(0);
    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: false, unreadableLines: [] })).toBe(undefined);
  });

  it("answers the ask for a row malformed only by its own still-real line, when the edit replaces that line", () => {
    const doc = parsed({ text: overCapRow() });

    expect(doc.problems).toEqual([
      "still-real check runs 31 words against a cap of 30 — say it shorter, the fold is for the detail",
    ]);
    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: true, unreadableLines: [] })).toEqual({
      askedIso: ASKED,
      question: QUESTION,
    });
  });

  it("answers nothing for that row when the edit leaves the still-real line in place", () => {
    const doc = parsed({ text: overCapRow() });

    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: false, unreadableLines: [] })).toBe(undefined);
  });

  it("answers nothing when the row is malformed by anything beside its still-real line", () => {
    const doc = parsed({ text: overCapRow().replace("\npriority: p1\n", "\npriority: p1\npriority: p2\n") });

    expect(doc.problems.length).toBeGreaterThan(1);
    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: true, unreadableLines: [] })).toBe(undefined);
  });
});

/** One line past the still-real cap of 30 words, in one sentence, so the word cap is the only one it breaks. */
const OVER_CAP = Array.from({ length: 31 }, (_, index) => `word${String(index)}`).join(" ");

/** The registered row with its still-real line hand-edited past the cap — the measured row. */
function overCapRow(): string {
  const edited = REGISTERED.replace(`stillReal: "${CHECK}"`, `stillReal: "${OVER_CAP}"`);
  expect(edited).not.toBe(REGISTERED);
  return edited;
}

describe("registeredAskChangeText", () => {
  it("reconfirm rewrites the check and its instant, and nothing the card asks", () => {
    const atIso = "2026-10-11T20:00:00.000Z";
    const change = { atIso, kind: "reconfirm", stillReal: "Shell.tsx has eight entries at a8ecbd09" } as const;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }));
    const doc = parsed({ text });

    expect(doc.stillReal).toBe("Shell.tsx has eight entries at a8ecbd09");
    expect(doc.stillRealIso).toBe(atIso);
    expect(doc.summary).toBe(QUESTION);
    expect(doc.askedIso).toBe(ASKED);
    expect(doc.problem).toBe("only Queue and Pull requests carry a count");
    expect(text).toContain("- **Still real** — Shell.tsx has eight entries at a8ecbd09\n");
    expect(text).not.toContain(`- **Still real** — ${CHECK}\n`);
    expect(text).toContain(`\n# ${QUESTION}\n`);
  });

  it("correct restates the question in front matter, H1 and the brief, with its reason and check", () => {
    const atIso = "2026-10-11T20:00:00.000Z";
    const corrected = "Should more console sidebar entries carry a count? Automations reads 6 today";
    const change = {
      atIso,
      kind: "correct",
      question: corrected,
      stillReal: "automation status: 5 FAILED, 1 STOPPED",
      why: "the count moved from 34 to 6",
    } as const;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }));
    const doc = parsed({ text });

    expect(doc.summary).toBe(corrected);
    expect(doc.statusSummary).toBe("Question corrected: the count moved from 34 to 6");
    expect(doc.stillReal).toBe("automation status: 5 FAILED, 1 STOPPED");
    expect(doc.stillRealIso).toBe(atIso);
    expect(doc.askedIso).toBe(ASKED);
    expect(text).toContain(`\n# ${corrected}\n`);
    expect(text).not.toContain(`\n# ${QUESTION}\n`);
    expect(briefText({ docText: text })).toContain(corrected);
    expect(briefText({ docText: text })).not.toContain(`\n${QUESTION}\n`);
  });

  it("correct refuses when the only matching heading is not the body's first line", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const moved = `${REGISTERED.replace(`\n# ${QUESTION}\n`, "\n# A hand-written heading\n")}\n# ${QUESTION}\n`;
    const quoted = `${REGISTERED.replace(`\n# ${QUESTION}\n`, "\n# A hand-written heading\n")}\n\`\`\`\n# ${QUESTION}\n\`\`\`\n`;

    const movedResult = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: moved });
    const quotedResult = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted });

    expect(moved).toContain(`\n# ${QUESTION}\n`);
    expect(unwrapErr(movedResult)).toEqual(RegisteredAskChangeErrors.headingMisplaced({ heading: `# ${QUESTION}` }));
    expect(unwrapErr(quotedResult)).toEqual(
      RegisteredAskChangeErrors.headingNotUnique({ count: 0, heading: `# ${QUESTION}` }),
    );
  });

  it("correct leaves a later body line that only happens to read as the old question", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const quoted = `${REGISTERED}\n\`\`\`\n${QUESTION}\n\`\`\`\n`;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(text).toContain("\n# Count it?\n");
    expect(briefText({ docText: text })).toContain("Count it?");
    expect(text).toContain(`\n\`\`\`\n${QUESTION}\n\`\`\`\n`);
  });

  it("correct finds the brief under the first section heading outside a code fence", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const fence = `\`\`\`\n## A quoted section\n${QUESTION}\n\`\`\``;
    const quoted = REGISTERED.replace(`\n# ${QUESTION}\n`, `\n# ${QUESTION}\n\n${fence}\n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(quoted).toContain(fence);
    expect(text).toContain(fence);
    expect(briefText({ docText: text })).toContain("\nCount it?\n");
  });

  it("correct restates the brief under the section briefText reads, not a hand-written section before it", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const note = `## Hand-written note\n\n${QUESTION}\n`;
    const noted = REGISTERED.replace("## What the owner asked for\n", `${note}\n## What the owner asked for\n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: noted }));

    expect(noted).toContain(note);
    expect(text).toContain(note);
    expect(briefText({ docText: text })).toContain("\nCount it?\n");
  });

  it("correct counts the old question's H1 outside code fences only, so a quoted copy neither refuses nor moves", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const fence = `\`\`\`md\n# ${QUESTION}\n\`\`\``;
    const quoted = `${REGISTERED}\n${fence}\n`;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(text).toContain("\n# Count it?\n");
    expect(text).toContain(fence);
  });

  it("correct leaves a question line that reads as a section heading, which briefText never reads as the brief", () => {
    const headed = "## Should we ship?";
    const change = { atIso: ASKED, kind: "correct", question: "Ship it now?", stillReal: undefined, why: "w" } as const;
    const text = REGISTERED.replaceAll(QUESTION, headed);

    const corrected = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: headed, text }));

    expect(text).toContain(`## What the owner asked for\n\n${headed}\n`);
    expect(corrected).toContain(`## What the owner asked for\n\n${headed}\n`);
    expect(corrected).toContain("\n# Ship it now?\n");
  });

  it("correct with no restated check leaves the check and its instant as they were", () => {
    const change = { atIso: "2026-10-11T20:00:00.000Z", kind: "correct", question: "Count it?", why: "w" } as const;

    const text = unwrap(
      registeredAskChangeText({
        change: { ...change, stillReal: undefined },
        path: PATH,
        previousQuestion: QUESTION,
        text: REGISTERED,
      }),
    );

    expect(parsed({ text }).stillReal).toBe(CHECK);
    expect(parsed({ text }).stillRealIso).toBe(ASKED);
    expect(parsed({ text }).summary).toBe("Count it?");
  });

  it("correct refuses a body whose question heading is not there to restate", () => {
    const change = { atIso: ASKED, kind: "correct", question: "Count it?", stillReal: undefined, why: "w" } as const;
    const text = REGISTERED.replace(`\n# ${QUESTION}\n`, "\n# A hand-written heading\n");

    const result = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text });

    expect(unwrapErr(result)).toEqual(
      RegisteredAskChangeErrors.headingNotUnique({ count: 0, heading: `# ${QUESTION}` }),
    );
  });

  it("keeps a CRLF row's line endings, so only the lines the edit names change", () => {
    const change = { atIso: "2026-10-11T20:00:00.000Z", kind: "reconfirm", stillReal: "still eight" } as const;
    const crlf = REGISTERED.replace(/\n/gu, "\r\n");

    const fromLf = unwrap(
      registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }),
    );
    const fromCrlf = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: crlf }));

    expect(crlf).toContain("\r\n");
    expect(fromCrlf).toBe(fromLf.replace(/\n/gu, "\r\n"));
    expect(fromCrlf.split("\r\n").join("")).not.toContain("\n");
  });

  it("refuses a row mixing CRLF and LF rather than rewriting either kind of line", () => {
    const change = { kind: "withdraw", why: "w" } as const;
    // Only the first line ends CRLF; every other line keeps LF.
    const [firstLine, ...otherLines] = REGISTERED.split("\n");
    const mixed = `${firstLine!}\r\n${otherLines.join("\n")}`;

    const result = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: mixed });

    expect(unwrapErr(result)).toEqual(RegisteredAskChangeErrors.mixedLineEndings());
  });

  it("withdraws a row keeping a comment line under the status it replaces, byte for byte", () => {
    const change = { kind: "withdraw", why: "w" } as const;
    const commented = REGISTERED.replace("\nstatus: ready\n", "\nstatus: ready\n# kept by hand\n");

    const withdrawn = unwrap(
      registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: commented }),
    );
    const plain = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }));

    expect(commented).toContain("\nstatus: ready\n# kept by hand\n");
    expect(withdrawn).toBe(plain.replace("\nstatus: cancelled\n", "\nstatus: cancelled\n# kept by hand\n"));
  });

  it("reconfirms a row keeping a blank line under the key it replaces", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const line = `stillReal: ${JSON.stringify(CHECK)}\n`;
    const spaced = REGISTERED.replace(line, `${line}\n`);

    const reconfirmed = unwrap(
      registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: spaced }),
    );
    const plain = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }));

    expect(spaced).toContain(`${line}\n`);
    expect(reconfirmed).toBe(plain.replace('stillReal: "still eight"\n', 'stillReal: "still eight"\n\n'));
  });

  it("refuses an edit of a key whose line carries a comment after its value", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const line = `stillReal: ${JSON.stringify(CHECK)}`;
    const commented = REGISTERED.replace(line, `${line} # keep this note`);

    const result = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: commented });

    expect(commented).toContain(`${line} # keep this note`);
    expect(unwrapErr(result)).toEqual(RegisteredAskChangeErrors.inlineComment({ key: "stillReal" }));
  });

  it("repairs an over-cap still-real line spelled with spaces before its colon, as the parser reads it", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const spacedKey = overCapRow().replace(`stillReal: "${OVER_CAP}"`, `stillReal   : "${OVER_CAP}"`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: spacedKey }));

    expect(parsed({ text: spacedKey }).stillReal).toBe(OVER_CAP);
    expect(text).toContain('\nstillReal: "still eight"\n');
    expect(text).not.toContain("stillReal   :");
    expect(parsed({ text }).problems).toEqual([]);
  });

  it("repairs an over-cap still-real line folded onto an indented continuation, the continuation going with it", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const folded = overCapRow().replace(`stillReal: "${OVER_CAP}"`, `stillReal: >\n  ${OVER_CAP}`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: folded }));

    expect(parsed({ text: folded }).stillReal).toBe(OVER_CAP);
    expect(text).toContain('\nstillReal: "still eight"\n');
    expect(text).not.toContain(`  ${OVER_CAP}`);
    expect(parsed({ text }).problems).toEqual([]);
  });

  it("refuses an edit of a key spelled with spaces before its colon whose line carries a comment", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const line = `stillReal: ${JSON.stringify(CHECK)}`;
    const commented = REGISTERED.replace(line, `stillReal  : ${JSON.stringify(CHECK)} # keep this note`);

    const result = registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: commented });

    expect(commented).toContain(`stillReal  : ${JSON.stringify(CHECK)} # keep this note`);
    expect(unwrapErr(result)).toEqual(RegisteredAskChangeErrors.inlineComment({ key: "stillReal" }));
  });

  it("restates a still-real bullet a hand edit left trailing whitespace on", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const trailing = REGISTERED.replace(`- **Still real** — ${CHECK}\n`, `- **Still real** — ${CHECK}  \n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: trailing }));

    expect(trailing).toContain(`- **Still real** — ${CHECK}  \n`);
    expect(text).toContain("- **Still real** — still eight\n");
    expect(text).not.toContain(CHECK);
  });

  it("leaves a still-real bullet byte for byte when an indented continuation makes it not the register's", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const bullet = `- **Still real** — ${CHECK}\n`;
    const continued = REGISTERED.replace(bullet, `${bullet}  and a hand-written continuation\n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: continued }));

    expect(continued).toContain(`${bullet}  and a hand-written continuation\n`);
    expect(text).toContain(`${bullet}  and a hand-written continuation\n`);
    expect(parsed({ text }).stillReal).toBe("still eight");
  });

  it("restates a bullet whose check carries a trailing space inside its quoted front-matter value too", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const spaced = REGISTERED.replace(`stillReal: "${CHECK}"`, `stillReal: "${CHECK} "`).replace(
      `- **Still real** — ${CHECK}\n`,
      `- **Still real** — ${CHECK} \n`,
    );

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: spaced }));

    // The row carries the space; the doc reader holds a prose field to one trimmed line, so it reads without it.
    expect(spaced).toContain(`stillReal: "${CHECK} "`);
    expect(parsed({ text: spaced }).stillReal).toBe(CHECK);
    expect(text).toContain("- **Still real** — still eight\n");
    expect(text).not.toContain(CHECK);
  });

  it("leaves a still-real bullet byte for byte when an unindented lazy continuation follows it", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const bullet = `- **Still real** — ${CHECK}\n`;
    const continued = REGISTERED.replace(bullet, `${bullet}a lazy continuation of that item\n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: continued }));

    expect(continued).toContain(`${bullet}a lazy continuation of that item\n`);
    expect(text).toContain(`${bullet}a lazy continuation of that item\n`);
    expect(parsed({ text }).stillReal).toBe("still eight");
  });

  it("leaves a body line that only starts like the still-real bullet, restating none when the real one is gone", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const lookalike = REGISTERED.replace(`- **Still real** — ${CHECK}\n`, "- **Still real** — an example line\n");

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: lookalike }));

    expect(lookalike).toContain("- **Still real** — an example line\n");
    expect(text).toContain("- **Still real** — an example line\n");
    expect(text).not.toContain("- **Still real** — still eight\n");
    expect(parsed({ text }).stillReal).toBe("still eight");
  });

  it("leaves the current check quoted outside the stakes list when the register's bullet is gone", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const quoted = `${REGISTERED.replace(`- **Still real** — ${CHECK}\n`, "- **Still real** — hand edited\n")}\n\`\`\`\n- **Still real** — ${CHECK}\n\`\`\`\n`;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(quoted).toContain(`\`\`\`\n- **Still real** — ${CHECK}\n\`\`\``);
    expect(text).toContain(`\`\`\`\n- **Still real** — ${CHECK}\n\`\`\``);
    expect(text).toContain("- **Still real** — hand edited\n");
    expect(text).not.toContain("- **Still real** — still eight\n");
  });

  it("leaves a stakes section quoted in a code fence when the register's heading is gone", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const quotedSection = `\`\`\`md\n## The stakes\n\n- **Still real** — ${CHECK}\n\`\`\``;
    const quoted = `${REGISTERED.replace("## The stakes\n", "## Hand-edited stakes\n")}\n${quotedSection}\n`;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(quoted).toContain(quotedSection);
    expect(text).toContain(quotedSection);
    expect(text).not.toContain("- **Still real** — still eight\n");
  });

  it("keeps a backtick fence open across a tilde line, so the stakes quoted after it stay quoted", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const quotedSection = `\`\`\`\`\n~~~\n## The stakes\n\n- **Still real** — ${CHECK}\n\`\`\`\n\`\`\`\``;
    const quoted = `${REGISTERED.replace("## The stakes\n", "## Hand-edited stakes\n")}\n${quotedSection}\n`;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: quoted }));

    expect(quoted).toContain(quotedSection);
    expect(text).toContain(quotedSection);
    expect(text).not.toContain("- **Still real** — still eight\n");
  });

  it("reads a backtick line whose info string holds a backtick as inline code, not a fence that hides the stakes", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const inline = REGISTERED.replace("## The stakes\n", "```not`a fence\n\n## The stakes\n");

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: inline }));

    expect(text).toContain("- **Still real** — still eight\n");
    expect(text).not.toContain(`- **Still real** — ${CHECK}\n`);
  });

  it("leaves a still-real line that a thematic break moved out of the register's three-bullet list", () => {
    const change = { atIso: ASKED, kind: "reconfirm", stillReal: "still eight" } as const;
    const broken = REGISTERED.replace(`- **Still real** — ${CHECK}\n`, `- - -\n- **Still real** — ${CHECK}\n`);

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: broken }));

    expect(broken).toContain(`- - -\n- **Still real** — ${CHECK}\n`);
    expect(text).toContain(`- - -\n- **Still real** — ${CHECK}\n`);
    expect(text).not.toContain("- **Still real** — still eight\n");
  });

  it("keeps a comment line the edit's keys do not precede", () => {
    const change = { kind: "withdraw", why: "w" } as const;
    const commented = REGISTERED.replace("\npriority: p1\n", "\npriority: p1\n# kept by hand\n");

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: commented }));

    expect(commented).toContain("\npriority: p1\n# kept by hand\n");
    expect(text).toContain("\npriority: p1\n# kept by hand\n");
  });

  it("withdraw cancels the row with its reason, settles nothing, and takes it off the Queue", () => {
    const change = { kind: "withdraw", why: "superseded by organisation-hunt-2026-10-11" } as const;

    const text = unwrap(registeredAskChangeText({ change, path: PATH, previousQuestion: QUESTION, text: REGISTERED }));
    const doc = parsed({ text });

    expect(doc.status).toBe("cancelled");
    expect(doc.statusSummary).toBe("Withdrawn, not the owner's answer: superseded by organisation-hunt-2026-10-11");
    expect(doc.settlement).toBeUndefined();
    expect(doc.ruling).toBeUndefined();
    expect(doc.summary).toBe(QUESTION);
    expect(registeredAskForChange({ doc, events: [], rewritesStillReal: false, unreadableLines: [] })).toBe(undefined);
  });
});
