/**
 * The one canonical example of a valid C3 pull-request form.
 *
 * Imported by BOTH the CLI tests' own fixtures and the CLI's `--form-example` output, so the two can never drift
 * apart: a complete, already-tested example sat unused in the test suite once while a real caller spent seven rounds
 * of `--dry-run` guessing the shape one Zod error at a time.
 *
 * It carries every part of the shape, so printing it answers the question a caller actually has: two ranked risks
 * (the top one checked, the next not), a problem seen on a day with who ran it unrecorded, a proof of the problem
 * that is a one-line reason, a proof of the solution that is a screenshot hosted as a GitHub user attachment and run
 * by an agent, one check with no screenshot, one thing not checked and why, and a re-run fold with a command. The
 * third slot shape, quoted output, is shown in `skills/github/reference/pr-forms.md` rather than here. Every
 * inline-run `kind` (`text`/`strong`/`em`/`code`/`link`) appears. Its prose follows the attribution rule — no first
 * person, the owner named as "the owner", a one-off act naming who did it — because this is the object a caller
 * copies, and an example that models a refused shape teaches every caller to write it.
 */
import type { PrFormDraft } from "./types.js";

export const EXAMPLE_PR_FORM: PrFormDraft = {
  checks: [[{ kind: "text", text: "A description written before this change still reads back to its form." }]],
  draft: true,
  explainer: [
    { kind: "text", text: "People exporting widgets lost the last entry when a sheet ended on a blank line, so " },
    { kind: "strong", text: "1 report in 40" },
    { kind: "text", text: " came out short. This keeps that entry and refuses a sheet it cannot read. See " },
    { kind: "link", text: "the export issue", url: "https://github.com/acme/widgets/issues?q=export" },
    { kind: "text", text: "." },
  ],
  notChecked: [
    {
      check: [{ kind: "text", text: "A sheet over 10,000 rows" }],
      why: [
        { kind: "text", text: "No fixture that large exists. The reader streams, so " },
        { kind: "em", text: "probably" },
        { kind: "text", text: " unaffected." },
      ],
    },
  ],
  problemProof: {
    kind: "reason",
    reason: [{ kind: "text", text: "The short export was reported in a file, and nothing on screen changes." }],
  },
  problemSeen: { by: "unrecorded", kind: "seen", on: "2026-09-28", what: "an exported report was one row short" },
  rerun: [{ kind: "command", lang: "sh", text: "yarn vitest run widgetExport.test.ts" }],
  risk: {
    items: [
      {
        check: { check: "The round-trip test covers a sheet ending on a blank line", kind: "checked" },
        worst: "an export refuses a sheet it used to read",
        worstKind: "something-working-breaks",
      },
      {
        check: { kind: "unchecked", why: "no sheet that large was exported" },
        worst: "a very large export is slower",
        worstKind: "something-working-breaks",
      },
    ],
  },
  solutionProof: {
    image: {
      alt: "the exported report with its last row present",
      kind: "image",
      url: "https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      width: 800,
    },
    kind: "screenshot",
    proves: [
      { kind: "text", text: "On this branch, " },
      { kind: "code", text: "widgets export" },
      { kind: "text", text: " keeps the last row." },
    ],
    runBy: "agent",
  },
  target: { base: "main", head: "a-branch", owner: "acme", repo: "widgets" },
  title: "fix(export): keep the last entry of a sheet",
  visualProof: "screen-change",
};
