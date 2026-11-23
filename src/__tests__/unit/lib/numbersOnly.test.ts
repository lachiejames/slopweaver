import { describe, expect, it } from "vitest";
import { sanitiseEvent, sanitiseLine, survivesNumbersOnly, WITHHELD } from "../../../lib/numbersOnly.js";

describe("survivesNumbersOnly", () => {
  it("DROPS a content preview entirely — it is nothing but content", () => {
    expect(
      survivesNumbersOnly({
        event: { lane: "content_preview", phase: "issues", preview: { snippet: "the retriever drops" } },
      }),
    ).toBe(false);
  });

  it("keeps a heartbeat, which is where the counts live", () => {
    expect(survivesNumbersOnly({ event: { done: 50, lane: "heartbeat", phase: "issues" } })).toBe(true);
  });
});

describe("sanitiseEvent", () => {
  it("keeps lane, phase, counts and metrics — everything a coverage claim rests on", () => {
    expect(
      sanitiseEvent({
        event: {
          done: 1200,
          lane: "heartbeat",
          metrics: { events: 9600, issues: 1200 },
          phase: "issues",
          total: 24000,
        },
      }),
    ).toEqual({
      done: 1200,
      lane: "heartbeat",
      metrics: { events: 9600, issues: 1200 },
      phase: "issues",
      total: 24000,
    });
  });

  it("WITHHOLDS the item title, which is a team key or a repo slug at almost every call site", () => {
    const sanitised = sanitiseEvent({
      event: { currentItem: { title: "SOMETEAM-1234" }, lane: "heartbeat", phase: "issues" },
    });
    expect(sanitised.currentItem).toEqual({ title: WITHHELD });
  });

  it("drops preview and learning payloads rather than trying to clean them", () => {
    const sanitised = sanitiseEvent({
      event: { lane: "heartbeat", learning: { note: "anything" }, phase: "issues", preview: { snippet: "anything" } },
    });
    expect(Object.hasOwn(sanitised, "preview")).toBe(false);
    expect(Object.hasOwn(sanitised, "learning")).toBe(false);
  });

  it("leaves an event with no strings at all untouched in substance", () => {
    expect(sanitiseEvent({ event: { lane: "heartbeat", phase: "projects" } })).toEqual({
      lane: "heartbeat",
      phase: "projects",
    });
  });

  it("omits a count that was absent rather than substituting a zero", () => {
    const sanitised = sanitiseEvent({ event: { done: 5, lane: "heartbeat", phase: "issues" } });
    expect(Object.hasOwn(sanitised, "total")).toBe(false);
  });
});

describe("sanitiseLine", () => {
  it("withholds every occurrence of the label, keeping the numbers around it", () => {
    expect(sanitiseLine({ label: "someowner/somerepo", text: "someowner/somerepo: wrote 12 new, deduped 3" })).toBe(
      `${WITHHELD}: wrote 12 new, deduped 3`,
    );
  });

  it("withholds an absolute home path, which the hygiene gate already treats as a leak class", () => {
    // ASSEMBLED at runtime, and that is the point rather than a workaround: an absolute home path IS one of
    // the leak classes the public hygiene gate scans tracked files for, so writing one as a literal here
    // would (correctly) fail the very gate this function exists to complement.
    const home = ["", "Users", "someone", ".slopweaver", "corpus", "bronze"].join("/");
    expect(sanitiseLine({ label: home, text: `→ ${home}` })).toBe(`→ ${WITHHELD}`);
  });

  it("leaves the line alone when there is no label to withhold", () => {
    expect(sanitiseLine({ label: "", text: "linear: wrote 40000 new" })).toBe("linear: wrote 40000 new");
  });

  it("leaves a line that does not contain the label unchanged", () => {
    expect(sanitiseLine({ label: "someowner/somerepo", text: "linear: wrote 40000 new" })).toBe(
      "linear: wrote 40000 new",
    );
  });
});
