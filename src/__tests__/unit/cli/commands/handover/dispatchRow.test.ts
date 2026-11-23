/**
 * `handover register --dispatch` — the flag that says a row asks the owner to pick nothing, and the two ways it
 * can contradict itself.
 *
 * The flag exists because the ask-shape gate read "not a finding" as "a decision waiting on the owner's word", which
 * refused every row `github landing --register` would have written. A finding's
 * PROVENANCE and a row's need for a DECISION are different properties, and these are the assertions that
 * keep them separate in both directions: `--dispatch` must exempt the shape, and it must not be able to
 * smuggle a real question — or a finding's team-facing hold — past anything.
 */
import { describe, expect, it } from "vitest";

import {
  dispatchConflicts,
  multilineRawFields,
  parseHandoverRegisterArgs,
} from "../../../../../cli/commands/handover/askRowArgs.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const FINDING_CLASH =
  "--dispatch and --finding declare different rows: a dispatch row is work a seat picks up, a finding " +
  "carries a session's own observation and a team-facing door holds on it. Pass one of them";

const shapeClash = ({ flags }: { flags: string }): string =>
  `--dispatch says nothing on this row waits on the owner's word, so ${flags} cannot be on it — ` +
  "drop --dispatch if this IS a decision of the owner's, or drop the shape if it is not";

describe("dispatchConflicts", () => {
  it("finds nothing on an invocation that never passed --dispatch, however shaped it is", () => {
    expect(dispatchConflicts({ values: { finding: true, problem: "the base is not derivable" } })).toEqual([]);
  });

  it("finds nothing on an ordinary dispatch row", () => {
    expect(
      dispatchConflicts({ values: { ask: "acme/widgets#1 needs rebase-and-fix", branch: "f/one", dispatch: true } }),
    ).toEqual([]);
  });

  it("refuses --dispatch beside --finding, because the two declare different rows", () => {
    expect(dispatchConflicts({ values: { dispatch: true, finding: true } })).toEqual([FINDING_CLASH]);
  });

  it("names every shape flag that was supplied, in the order they are written", () => {
    expect(
      dispatchConflicts({ values: { dispatch: true, lean: "main", options: "a :: b", problem: "which base" } }),
    ).toEqual([shapeClash({ flags: "--problem, --options, --lean" })]);
  });

  // Presence is read off the SUPPLIED flag rather than off `shapeCompleteness`, which collapses an empty
  // string into absence. `--dispatch --problem ""` is a caller contradicting itself, not one passing nothing.
  it("refuses an EMPTY shape flag, which reads as absent to every completeness check", () => {
    expect(dispatchConflicts({ values: { dispatch: true, problem: "" } })).toEqual([
      shapeClash({ flags: "--problem" }),
    ]);
  });

  it("refuses --keep-lines on a row that is not a dispatch, which can head the owner's card", () => {
    expect(dispatchConflicts({ values: { "keep-lines": true } })).toEqual([
      "--keep-lines is only for a --dispatch row, which heads no card of the owner's. Drop it, or pass --dispatch",
    ]);
  });

  it("reports both contradictions at once rather than making the caller fix them one run at a time", () => {
    expect(dispatchConflicts({ values: { dispatch: true, finding: true, lean: "main" } })).toEqual([
      FINDING_CLASH,
      shapeClash({ flags: "--lean" }),
    ]);
  });
});

describe("multilineRawFields", () => {
  const INJECTED_BRANCH =
    'feature/one\nproblem: "which base"\nlean: "main"\noptions:\n  - option: "a"\n    tradeoff: "b"';
  const newlineRefusal = ({ flag }: { flag: string }): string =>
    `${flag} carries a newline, and no field in a row's front-matter has a legitimate multi-line ` +
    "value. The writer quotes it rather than letting a second line become a KEY, so what would reach the " +
    "board is a multi-line value no exact match can ever hit. It is one value on one line";

  it("finds nothing in ordinary single-line values", () => {
    expect(multilineRawFields({ values: { branch: "feature/one", priority: "p1", slug: "a-slug" } })).toEqual([]);
  });

  // The counterexample this check exists for, found by r1 review and reproduced: a `--branch` holding a
  // whole ask shape wrote it into the front-matter as real keys, and the parser read it back with no
  // problems — a decision the owner had to take, authored by an argv the shape gate never saw.
  it("refuses a --branch carrying a whole ask shape, which would otherwise reach the file as real keys", () => {
    expect(multilineRawFields({ values: { branch: INJECTED_BRANCH, dispatch: true } })).toEqual([
      newlineRefusal({ flag: "--branch" }),
    ]);
  });

  it("names every offending raw field, in the order they are written", () => {
    expect(multilineRawFields({ values: { anchor: "a\nb", priority: "p1\nc", slug: "x\ny" } })).toEqual([
      newlineRefusal({ flag: "--slug" }),
      newlineRefusal({ flag: "--anchor" }),
      newlineRefusal({ flag: "--priority" }),
    ]);
  });

  // `--options` is one flag holding one option per LINE, so a newline in it is the format rather than an
  // injection; `--ask`, `--problem` and `--lean` reach the file through `JSON.stringify`, which escapes one.
  it("leaves --options alone, whose newlines ARE its format", () => {
    expect(multilineRawFields({ values: { options: "count them :: one field\nleave it :: unknown" } })).toEqual([]);
  });

  it("leaves the JSON-quoted fields alone, which cannot break out of their own scalar", () => {
    expect(multilineRawFields({ values: { ask: "a\nb", lean: "c\nd", problem: "e\nf" } })).toEqual([]);
  });
});

describe("parseHandoverRegisterArgs", () => {
  it("refuses an injecting --branch at parse time, before anything reaches the handovers directory", () => {
    const parsed = parseHandoverRegisterArgs({
      rest: ["--ask", "which base", "--dispatch", "--branch", 'feature/one\nproblem: "which base"'],
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("--branch carries a newline");
  });

  it("accepts --dispatch as a switch and carries it through", () => {
    const parsed = parseHandoverRegisterArgs({
      rest: ["--ask", "acme/widgets#1 needs rebase-and-fix", "--dispatch", "--branch", "feature/one"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values["dispatch"]).toBe(true);
  });

  it("refuses the contradiction at PARSE time, before the plan reads a transcript or touches the board", () => {
    const parsed = parseHandoverRegisterArgs({
      rest: ["--ask", "x", "--dispatch", "--finding", "--evidence", "acme/widgets#1"],
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([FINDING_CLASH]);
  });

  it("still refuses an unknown flag first, so a typo is not reported as a dispatch contradiction", () => {
    const parsed = parseHandoverRegisterArgs({ rest: ["--ask", "x", "--dispatch", "--whatever"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --whatever"]);
  });

  it("leaves a shaped ordinary ask alone, which is the row the shape ruling is actually about", () => {
    const parsed = parseHandoverRegisterArgs({
      rest: ["--ask", "x", "--problem", "which base", "--options", "main :: a", "--lean", "main"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values["dispatch"]).toBeUndefined();
  });
});

describe("the bytes a dispatch row is written as", () => {
  const dispatchRow = (): string =>
    askRowText({
      anchor: undefined,
      ask: "acme/widgets#16378 needs rebase-and-fix: add the widget — required check(s) failing: build",
      askedIso: "2026-09-19T12:00:00.000Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: "feature/one",
      dispatch: true,
      finding: undefined,
      priority: undefined,
      repo: "/checkouts/widgets",
      shape: undefined,
      slug: "land-acme-widgets-16378-1111111",
    });

  it("is headed `Work to dispatch`, never the ask heading over a brief the owner never wrote", () => {
    expect(dispatchRow()).toContain("## Work to dispatch\n");
    expect(dispatchRow()).not.toContain("## What the owner asked for");
  });

  it("says in the body that nobody is waiting on the owner's word, since the front-matter carries no discriminator", () => {
    expect(dispatchRow()).toContain(
      "Registered as work a seat picks up, not as a question: nobody is waiting on the owner's word here, so this row",
    );
  });

  it("declares no finding origin, so no team-facing door holds the work rule 10 names", () => {
    expect(dispatchRow()).not.toContain("origin: finding");
    expect(dispatchRow()).not.toContain("observedBy:");
  });

  it("parses back as a clean ready ask row, with no shape and no defect the board would report", () => {
    const doc = parseHandoverDoc({ path: "/state/handovers/land-acme-widgets-16378-1111111.md", text: dispatchRow() });
    expect(doc.kind).toBe("ask");
    expect(doc.status).toBe("ready");
    expect(doc.branch).toBe("feature/one");
    expect(doc.askedIso).toBe("2026-09-19T12:00:00.000Z");
    expect(doc.origin).toBeUndefined();
    expect(doc.problem).toBeUndefined();
    expect(doc.lean).toBeUndefined();
    expect(doc.options).toEqual([]);
  });

  it("leaves an ordinary ask's body exactly where it was, so this flag changed one arm and not three", () => {
    const ordinary = askRowText({
      anchor: undefined,
      ask: "account for every stuck chat",
      askedIso: "2026-09-19T12:00:00.000Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "stuck-chat-ask",
    });
    expect(ordinary).toContain("## What the owner asked for\n");
    expect(ordinary).not.toContain("## Work to dispatch");
  });
});
