/*
 * `routeEditForm`: one edit form routed once by its `kind`, so a checklist or a poll is never parsed as a card,
 * and a form of one of those kinds that does not validate reports its own field rather than "unrecognized keys".
 */
import { describe, expect, it } from "vitest";

import { type EditFormRoute, routeEditForm } from "../../../../../cli/commands/slack/lifecycleEditForms.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CHECKLIST = {
  kind: "checklist",
  modelId: "claude-opus-5-5",
  steps: [{ id: "s1", state: "done", title: "Read the thread" }],
  task: "Why the pool exhausted",
};

const POLL = { kind: "poll", options: ["Tuesday", "Thursday"], question: "Which day?", why: "The slot clashes." };

/** A route narrowed loudly to one kind — never narrowed inside an assertion. */
function routeOf<K extends EditFormRoute["kind"]>({
  json,
  kind,
}: {
  json: string;
  kind: K;
}): Extract<EditFormRoute, { kind: K }> {
  const route = routeEditForm({ json });
  if (route.kind !== kind) {
    throw new Error(`expected a ${kind} route, got ${route.kind}`);
  }
  // `as`: the `kind` check above is the narrowing; TypeScript cannot carry it across a generic `K`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return route as Extract<EditFormRoute, { kind: K }>;
}

describe("routeEditForm", () => {
  it.each([
    { json: "{not json", name: "text that is not JSON" },
    { json: JSON.stringify({ kind: "update", tldr: "A lead." }), name: "an update-family form" },
    { json: JSON.stringify({ tldr: "A lead." }), name: "a form naming no kind" },
  ])("hands $name to the card path to parse", ({ json }) => {
    expect(routeEditForm({ json })).toEqual({ kind: "card" });
  });

  it("routes a valid checklist form with its parsed steps", () => {
    expect(unwrap(routeOf({ json: JSON.stringify(CHECKLIST), kind: "checklist" }).form)).toEqual(CHECKLIST);
  });

  it("routes a checklist form that does not validate with the field that is wrong", () => {
    const { form } = routeOf({ json: JSON.stringify({ ...CHECKLIST, steps: [] }), kind: "checklist" });

    expect(unwrapErr(form).join("\n")).toContain("steps");
  });

  it("routes a valid poll form", () => {
    expect(unwrap(routeOf({ json: JSON.stringify(POLL), kind: "poll" }).form)).toEqual(POLL);
  });
});
