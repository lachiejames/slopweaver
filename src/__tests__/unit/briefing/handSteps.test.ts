import { describe, expect, it } from "vitest";

import { HAND_STEPS_MAX_ROWS } from "../../../briefing/caps.js";
import { NO_HAND_STEPS, projectHandStepRow, projectHandSteps } from "../../../briefing/handSteps.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { handStepsSchema } from "../../../outbound/briefing/handStepsSchema.js";

/** One open step, varying only what a test cares about. */
function step(over: Partial<Parameters<typeof buildHandStep>[0]["draft"]> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "trelica-signin",
        postedBy: "workspace:129",
        postedIso: "2026-09-19T18:25:44.275Z",
        unblocks: "every scheduled Trelica resync, each one exiting 1 with SESSION_LOST",
        what: "Sign in to Trelica in Chrome — the signed-in session is gone",
        witness: 'slopweaver hand done trelica-signin --did "signed in"',
        ...over,
      },
    }),
  );
}

describe("projectHandStepRow", () => {
  it("carries the register's own bytes, with no optional field invented", () => {
    const row = projectHandStepRow({ step: step() });
    expect(row.id).toBe("trelica-signin");
    expect(row.what).toBe("Sign in to Trelica in Chrome — the signed-in session is gone");
    expect(row.unblocks).toBe("every scheduled Trelica resync, each one exiting 1 with SESSION_LOST");
    expect(row.postedIso).toBe("2026-09-19T18:25:44.275Z");
    expect(row.witness).toBe('slopweaver hand done trelica-signin --did "signed in"');
    expect(Object.keys(row).toSorted()).toEqual(["id", "postedIso", "tier", "unblocks", "what", "witness"]);
  });

  it("attaches each optional only when the step carried it, never as an undefined key", () => {
    const row = projectHandStepRow({
      step: step({ literal: "gcloud auth application-default login", url: "https://console.cloud.google.com" }),
    });
    expect(row.literal).toBe("gcloud auth application-default login");
    expect(row.url).toBe("https://console.cloud.google.com");
    // `exactOptionalPropertyTypes` makes "absent" and "present as undefined" different values, and the
    // schema reads the first as absent rather than as a field to validate.
    expect(Object.keys(row).includes("where")).toBe(false);
  });

  it("never substitutes the witness for a missing command — a step with no literal gets none", () => {
    // The witness SETTLES the step. Promoting it would hand the owner the command that closes the thing at the
    // moment they are looking for the one that does it.
    const row = projectHandStepRow({ step: step({ where: "the Trelica admin console" }) });
    expect(row.where).toBe("the Trelica admin console");
    expect(Object.keys(row).includes("literal")).toBe(false);
  });
});

describe("projectHandSteps", () => {
  it("is empty when nothing is waiting on the owner's hands", () => {
    expect(projectHandSteps({ steps: [] })).toEqual(NO_HAND_STEPS);
    expect(NO_HAND_STEPS.rows).toEqual([]);
    expect(NO_HAND_STEPS.notShown).toBe(0);
  });

  it("keeps the register's own order — oldest first, never re-sorted", () => {
    const older = step({ id: "older", postedIso: "2026-09-19T18:25:44.275Z" });
    const newer = step({ id: "newer", postedIso: "2026-09-20T14:51:08.996Z" });
    expect(projectHandSteps({ steps: [older, newer] }).rows.map((row) => row.id)).toEqual(["older", "newer"]);
  });

  it("states how many it is not showing rather than truncating silently", () => {
    const steps = Array.from({ length: HAND_STEPS_MAX_ROWS + 3 }, (_unused, index) =>
      step({ id: `step-${String(index)}` }),
    );
    const section = projectHandSteps({ steps });
    expect(section.rows.length).toBe(HAND_STEPS_MAX_ROWS);
    expect(section.notShown).toBe(3);
    expect(section.rows.at(-1)!.id).toBe(`step-${String(HAND_STEPS_MAX_ROWS - 1)}`);
  });

  it("shows every step and claims nothing unshown when the register fits", () => {
    const section = projectHandSteps({ steps: [step({ id: "one" }), step({ id: "two" })] });
    expect(section.rows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(section.notShown).toBe(0);
  });

  it("carries the register's unread-line count onto the section rather than dropping it", () => {
    const section = projectHandSteps({ steps: [step()], unreadable: 2 });
    expect(section.unreadable).toBe(2);
    expect(section.rows.length).toBe(1);
  });

  it("reports no unread lines when the caller named none", () => {
    expect(projectHandSteps({ steps: [step()] }).unreadable).toBe(0);
  });

  it("ranks before it caps: the work step leads, the check-in ends, and a check-in never takes a blocker's slot", () => {
    const steps = [
      step({ checkIn: true, id: "try-now-page" }),
      step({ id: "chair-respawn" }),
      step({ context: "work", id: "owners-885" }),
    ];
    expect(projectHandSteps({ steps }).rows.map((row) => row.id)).toEqual([
      "owners-885",
      "chair-respawn",
      "try-now-page",
    ]);
    const capped = projectHandSteps({ steps, top: 2 });
    expect(capped.rows.map((row) => row.id)).toEqual(["owners-885", "chair-respawn"]);
    expect(capped.notShown).toBe(1);
  });

  it("carries each step's tier onto its row", () => {
    expect(projectHandStepRow({ step: step({ checkIn: true }) }).tier).toBe("check-in");
    expect(projectHandStepRow({ step: step({ context: "work" }) }).tier).toBe("team-blocked");
    expect(projectHandStepRow({ step: step() }).tier).toBe("fleet-blocked");
  });

  it("projects a section its own schema accepts when an older check-in sits behind a newer blocker", () => {
    const section = projectHandSteps({
      steps: [
        step({ checkIn: true, id: "try-now-page", postedIso: "2026-09-19T01:00:00.000Z" }),
        step({ id: "chair-respawn", postedIso: "2026-09-20T01:00:00.000Z" }),
      ],
    });
    expect(section.rows.map((row) => row.id)).toEqual(["chair-respawn", "try-now-page"]);
    expect(handStepsSchema.safeParse(section).success).toBe(true);
  });

  it("honours an explicit top, so a caller can show fewer than the cap", () => {
    const section = projectHandSteps({ steps: [step({ id: "one" }), step({ id: "two" })], top: 1 });
    expect(section.rows.map((row) => row.id)).toEqual(["one"]);
    expect(section.notShown).toBe(1);
  });
});
