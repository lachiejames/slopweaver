/*
 * One hand step that does not read whole is ITS card's problem, never the list's. Measured: a single `file://` url
 * refused the whole reading and both of the owner's hand cards vanished from the Queue. Driven through the real reader
 * and card builder.
 */
import { describe, expect, it } from "vitest";

import { type HandStep, readHandSteps } from "../../components/live/read";
import { handCard, stepCardTemplateText, stepRows, unreadableStepLine } from "../../lib/handCard";

const GOOD = {
  id: "linear-token",
  postedIso: "2026-10-06T17:30:00.000Z",
  url: "https://linear.app/acme/settings/account/security",
  what: "Create a Linear personal API key and paste it into the field below",
};

const LOCAL = "file:///Users/someone/.slopweaver/pages/tobias-9am-brief/index.html";

const BAD = {
  id: "tobias-9am-brief",
  postedIso: "2026-10-06T17:32:00.000Z",
  url: LOCAL,
  what: "Read the brief for the 9am with Tobias",
};

/** The two steps the reader keeps from a list whose second line carries a `file://` url. */
function readTwo(): readonly HandStep[] {
  return readHandSteps([GOOD, BAD])!;
}

describe("a step that does not read whole", () => {
  it("leaves the step before it whole, with its url as posted", () => {
    const first = readTwo()[0];
    expect(first.id).toBe("linear-token");
    expect(first.url).toBe(GOOD.url);
    expect(first.unreadable).toBeUndefined();
  });

  it("reads itself as unreadable naming url, with every other field blank", () => {
    const steps = readTwo();
    expect(steps.length).toBe(2);
    const second = steps[1];
    expect(second.id).toBe("tobias-9am-brief");
    expect(second.what).toBe(BAD.what);
    expect(second.unreadable).toBe("url");
    expect(second.url).toBeUndefined();
    expect(second.checkIn).toBe(false);
    expect(second.cites).toEqual([]);
    expect(second.secrets).toEqual([]);
  });

  it("is drawn as a could-not-read row, with no no-address row beside it", () => {
    const second = readTwo()[1];
    const rows = stepRows({ step: second });
    expect(rows).toContainEqual({
      label: "could not read",
      value: unreadableStepLine({ field: "url", id: second.id }),
    });
    expect(rows.map((row) => row.label)).not.toContain("no address");
  });

  it("is admitted by the template-text check, its could-not-read line included", () => {
    const step = readTwo()[1];
    const { card, form } = handCard({ step });
    expect(stepCardTemplateText({ card, step })).toEqual([]);
    expect(form).toEqual({ kind: "drawn" });
  });

  it("is skipped when it carries no id, sentence or posting instant, or is not an object", () => {
    expect(readHandSteps([{ postedIso: "t", what: "w" }])).toEqual([]);
    expect(readHandSteps([{ id: "x", postedIso: "t" }])).toEqual([]);
    expect(readHandSteps([{ id: "x", what: "w" }])).toEqual([]);
    expect(readHandSteps(["a line"])).toEqual([]);
  });
});

describe("the stopsWork mark a monitor posts", () => {
  it("keeps true, leaves it absent when the step carries none, and reads anything else as unreadable", () => {
    const steps = readHandSteps([
      { ...GOOD, stopsWork: true },
      GOOD,
      { ...GOOD, stopsWork: false },
      { ...GOOD, stopsWork: "yes" },
    ])!;
    expect(steps.map((step) => [step.stopsWork, step.unreadable])).toEqual([
      [true, undefined],
      [undefined, undefined],
      [undefined, "stopsWork"],
      [undefined, "stopsWork"],
    ]);
  });

  it("keeps the mark on a step another field of which did not read", () => {
    const steps = readHandSteps([
      { ...GOOD, cites: "not-an-array", stopsWork: true },
      { ...GOOD, checkIn: true, cites: "not-an-array", stopsWork: true },
    ])!;
    expect(steps.map((step) => [step.stopsWork, step.unreadable])).toEqual([
      [true, "cites"],
      [undefined, "cites"],
    ]);
  });
});
