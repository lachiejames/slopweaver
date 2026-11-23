/**
 * The render seams and forms the byte-cap and bare-reference close cases run over: heavy `earlierToday` notes, the
 * render that refuses a form past a note count the way the real one refuses a page over its byte cap, and the
 * render whose passing page links one repository. `seatHeavyForm`, `notesIn` and the renders read the seat
 * directory, so call them only inside a case.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";

import { PAGE_TEXT_MAX_BYTES } from "../../../../../../briefing/caps.js";
import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { FORM } from "../tickFixtures.js";
import { dir } from "./harness.js";
import { arrayField, jsonObject } from "./parsedJson.js";

/**
 * `count` earlierToday notes, newest first, each carrying its index and about a kilobyte of JSON.
 *
 * @returns the notes
 */
export function heavyNotes({ count }: { count: number }): readonly { headline: unknown[]; pad: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    headline: [{ kind: "text", text: `note ${String(index)}` }],
    pad: "x".repeat(1000),
  }));
}

/** The seat's form, with `count` heavy notes in earlierToday. */
export function seatHeavyForm({ count }: { count: number }): void {
  const form = { ...FORM, earlierToday: { notes: heavyNotes({ count }), summary: "earlier today" } };
  writeFileSync(join(dir, "form.json"), `${JSON.stringify(form, null, 2)}\n`);
}

/**
 * The earlierToday notes of a form's text.
 *
 * @returns the notes
 */
export function notesOf({ text }: { text: string }): readonly unknown[] {
  const earlierToday = jsonObject({ text })["earlierToday"];
  if (!isRecord(earlierToday)) {
    throw new TypeError("the form holds no earlierToday object");
  }
  return arrayField({ key: "notes", record: earlierToday });
}

/**
 * The earlierToday notes of a form file.
 *
 * @returns the notes
 */
export function notesIn({ path }: { path: string }): readonly unknown[] {
  return notesOf({ text: readFileSync(path, "utf8") });
}

/**
 * A render that refuses a form carrying more than `fits` earlierToday notes, the way the real one refuses a page
 * over its byte cap: a refused page beside `--out`, `overBytes` past the cap, and the typed code.
 *
 * @param fits the most notes a page may carry and still render
 * @param overBytes how far past the cap a refused page sits
 * @param refusalCode the code a refusal carries
 * @param forms every form text the render was handed, in order
 * @returns the render seam
 */
export function sizedRender({
  fits,
  overBytes,
  refusalCode = "RENDER_TOO_LARGE",
  forms,
}: {
  fits: number;
  overBytes: number;
  refusalCode?: "RENDER_TOO_LARGE" | "RENDER_CHECK_FAILED";
  forms: string[];
}): SupervisorTickDeps["render"] {
  return ({ argv, formText }) => {
    forms.push(formText);
    const out = argv[argv.indexOf("--out") + 1]!;
    const notes = notesOf({ text: formText });
    if (notes.length <= fits) {
      const pages = new Map([[out, "<p>fits</p>"]]);
      return Promise.resolve({ diagnostics: [], exitCode: EXIT_OK, pages, refusalCode: undefined });
    }
    const refused = join(dir, "tick-1", "page.fragment.refused.html");
    return Promise.resolve({
      diagnostics: [`refused: ${String(notes.length)} notes`],
      exitCode: EXIT_ERROR,
      pages: new Map([[refused, "x".repeat(PAGE_TEXT_MAX_BYTES + overBytes)]]),
      refusalCode,
    });
  };
}

/**
 * `count` earlierToday notes, newest first, each carrying a bare pull-request reference spelled as `spelling` — real notes the
 * section schema parses, since the writer leaves a note it cannot render untouched.
 *
 * @returns the notes
 */
export function refNotes({ count, spelling }: { count: number; spelling: string }): readonly { headline: unknown[] }[] {
  return Array.from({ length: count }, (_, index) => ({
    headline: [{ kind: "text", text: `note ${String(index)} landed ${spelling}` }],
  }));
}

/**
 * A render whose passing page links one repository, as tick 20's did, refusing as too large a QUALIFIED form
 * carrying more than `fitsQualified` notes — the bytes qualification itself adds.
 *
 * @param fitsQualified the most qualified notes a page may carry and still render
 * @param forms every form text the render was handed, in order
 * @returns the render seam
 */
export function linkingRender({
  fitsQualified,
  forms,
}: {
  fitsQualified: number;
  forms: string[];
}): SupervisorTickDeps["render"] {
  return ({ argv, formText }) => {
    forms.push(formText);
    const out = argv[argv.indexOf("--out") + 1]!;
    if (formText.includes("acme/widget#2687") && notesOf({ text: formText }).length > fitsQualified) {
      const refused = join(dir, "tick-1", "page.fragment.refused.html");
      const pages = new Map([[refused, "x".repeat(PAGE_TEXT_MAX_BYTES + 1)]]);
      return Promise.resolve({
        diagnostics: ["refused"],
        exitCode: EXIT_ERROR,
        pages,
        refusalCode: "RENDER_TOO_LARGE",
      });
    }
    const pages = new Map([
      [out, `<p><a href="https://github.com/acme/widget/pull/2686">#2686</a> ${String(forms.length)}</p>`],
    ]);
    return Promise.resolve({ diagnostics: [], exitCode: EXIT_OK, pages, refusalCode: undefined });
  };
}
