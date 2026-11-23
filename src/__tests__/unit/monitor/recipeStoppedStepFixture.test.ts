/*
 * The console's queue test (`site/__tests__/unit/queueRowsRecipeStopped.test.ts`) ranks a recipe-stopped hand
 * step read from a committed fixture, because the site's own build cannot compile the monitor's modules. This
 * test is the other end of that fixture: the real monitor card and hand register still produce it byte for
 * byte — through `buildArrival`, the path `monitor check --fire` takes, so the posting form it answers to is the
 * one this fixture passed, and the site test ranks what the monitor would actually post.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { evaluateRecipeStopped } from "../../../monitor/evaluateStopped.js";
import { monitorDefinition } from "../../../monitor/registry.js";

const FIXTURE = new URL("../../../../site/fixtures/hand-steps/recipe-stopped.json", import.meta.url);

describe("the site's recipe-stopped step fixture", () => {
  it("is exactly what the monitor's own card builds for one missed row", () => {
    const reading = evaluateRecipeStopped({
      rows: [
        {
          cadence: "30 9 * * *",
          currentSlotHold: null,
          detail: "2 slot(s) of `30 9 * * *` went by unrun; it last ran 2026-09-24T09:30:04Z",
          lastRunAtIso: "2026-09-24T09:30:04.000Z",
          missedSlots: 2,
          reach: { destination: "slack", effect: "read-write", kind: "vulnfix-digest" },
          reason: "MISSED",
          recipeId: "vulnfix-digest-acme-admin",
        },
      ],
      taken: new Map(),
    });
    expect(reading.state).toBe("firing");
    const [subject] = (reading as Extract<typeof reading, { state: "firing" }>).subjects;
    const step = buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition: monitorDefinition({ monitorId: "recipe-stopped" }),
      nowIso: "2026-09-26T09:59:00.000Z",
      postedBy: "workspace:12",
      subject: subject!,
    });
    expect(step.isOk()).toBe(true);

    const built = JSON.parse(JSON.stringify(unwrap(step))) as unknown;

    expect(built).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown);
  });
});
