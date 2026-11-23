import { describe, expect, it } from "vitest";

import { alertSummaryFormSchema, alertSummaryToUpdate } from "../../../../../outbound/artifact/alertSummary.js";
import { everyRun, indexText, messageOf, tallyForm } from "./harness.js";

describe("alertSummaryToUpdate — this card CANNOT ping anyone, from any input", () => {
  /**
   * The requirement: the card must not ping or tag anyone. The form makes it structurally impossible — there is no owner field and no mention syntax — and
   * these tests are what stop that being merely true today.
   */
  const PING_ATTEMPTS: readonly string[] = [
    "@here",
    "@channel",
    "<!here>",
    "<!channel>",
    // Deliberately not a real-shaped Slack id: the hygiene gate flags that pattern anywhere in the repo, and
    // what is under test is that ANY ping-shaped text stays text.
    "<@SOMEONE>",
    "@everyone please look",
  ];

  it("emits no mention or broadcast run for the reference tally", () => {
    const kinds = new Set(everyRun({ artifact: alertSummaryToUpdate({ form: tallyForm() }) }).map((run) => run.type));

    expect(kinds.has("mention")).toBe(false);
    expect(kinds.has("broadcast")).toBe(false);
    // Exactly the two run types this derivation can produce, and no third. The reference tally carries one cited
    // row, so both appear — which is what makes the empty-of-mentions claim above a real measurement rather than a
    // statement about a card that happened to have nothing in it.
    expect([...kinds].toSorted()).toEqual(["citation", "text"]);
  });

  it("emits no mention or broadcast run even when every text field TRIES to be one", () => {
    const artifacts = PING_ATTEMPTS.map((attempt) =>
      alertSummaryToUpdate({
        form: {
          kind: "alert-summary",
          label: attempt,
          lead: attempt,
          rows: [{ count: 3, label: attempt }],
          skipped: 1,
          window: attempt,
        },
      }),
    );
    const kinds = new Set(artifacts.flatMap((artifact) => everyRun({ artifact }).map((run) => run.type)));

    expect(kinds.has("mention")).toBe(false);
    expect(kinds.has("broadcast")).toBe(false);
    // Nothing but plain text: these forms carry no citation, and there is no third thing a text field can become.
    // A future field that turned prose into a ping would show up here as a new run type.
    expect([...kinds].toSorted()).toEqual(["text"]);
  });

  it("carries the ping-shaped text through as LITERAL text, so nothing is silently rewritten", () => {
    const artifact = alertSummaryToUpdate({
      form: { ...tallyForm(), lead: "<!channel> take a look", rows: [{ count: 2, label: "@here flapping" }] },
    });

    expect(artifact.tldr).toBe("Gateway 7d · P4 · 2 fired across 1 monitor. <!channel> take a look");
    expect(indexText({ index: artifact.index })).toEqual(["🟡 P4 · @here flapping · impact ? · 2×"]);
  });

  it("REFUSES a form that tries to add an owner to ping, rather than ignoring the field", () => {
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), owner: { person: "someone" } });

    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain('unknown field "owner" — REFUSED, not ignored.');
  });
});
