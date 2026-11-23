/**
 * One `--open-artifacts` entry decoded into a projected card's fields: a marked page supplies the question and
 * lean, and an entry typing either beside those marks is refused.
 */
import { describe, expect, it } from "vitest";

import { BriefingErrors } from "../../../briefing/errors.js";
import { decodeCardFields, stringField } from "../../../briefing/openPageEntry.js";

const QUEUE = "file:///Users/owner/.slopweaver/pages/queue/index.html";
const ENTRY = {
  ifSilent: "The console keeps opening on Acme.",
  label: "The queue decision",
  options: [
    { letter: "A", text: "Open on Acme." },
    { letter: "B", text: "Open on Slopweaver." },
  ],
  url: QUEUE,
  what: "The console opens on one queue by default.",
  whyYou: "Only you know which queue you read first.",
};
const MARKED = { kind: "marked", lean: "A, because they read it.", question: "Which queue first?" } as const;

describe("decodeCardFields", () => {
  it("reads the question and lean from a page that marks them", () => {
    const fields = decodeCardFields({ page: MARKED, url: QUEUE, value: ENTRY });

    expect(fields._unsafeUnwrap()).toEqual({
      ifSilent: ENTRY.ifSilent,
      lean: MARKED.lean,
      options: ENTRY.options,
      question: MARKED.question,
      what: ENTRY.what,
      whyYou: ENTRY.whyYou,
    });
  });

  it("refuses an entry typing a lean beside the page's own marks", () => {
    const fields = decodeCardFields({ page: MARKED, url: QUEUE, value: { ...ENTRY, lean: "B, it can wait." } });

    expect(fields._unsafeUnwrapErr()).toEqual(
      BriefingErrors.openPageTypesPageFields({ keys: ["lean"], label: ENTRY.label }),
    );
  });

  it("names every missing field when the page supplies no pair and the entry types none", () => {
    const fields = decodeCardFields({ page: { kind: "typed" }, url: QUEUE, value: ENTRY });

    expect(fields._unsafeUnwrapErr()).toEqual(
      BriefingErrors.openPageFieldsMissing({ label: ENTRY.label, missing: ["question", "lean"] }),
    );
  });
});

describe("stringField", () => {
  it("answers a non-empty string and nothing for an empty or non-string value", () => {
    const record = { empty: "", label: "The queue decision", count: 3 };

    expect([
      stringField({ key: "label", record }),
      stringField({ key: "empty", record }),
      stringField({ key: "count", record }),
      stringField({ key: "absent", record }),
    ]).toEqual(["The queue decision", undefined, undefined, undefined]);
  });
});
