/**
 * Every act `github landing` can emit is a state on the pull-requests page's selector, and the page names no act
 * the verb does not emit.
 *
 * MEASURED on one reading (`slopweaver reading last --producer "github landing" --json`):
 * `site/lib/pullRequestsVoice.ts` keyed its groups on `answer` and `wait`, words `src/review/landing.ts` has
 * never emitted, so 22 of 31 rows — every `blocked-on`, `stacked` and `queued` one — sat in the catch-all
 * while "Waiting on a named person" printed a zero. The site tests used the same wrong words, so they stayed
 * green. The console cannot import `src/`, so the link between the two vocabularies is this text-level check.
 *
 * {@link HEADED} is keyed by `LandingAction`, so a fourteenth act fails to COMPILE here until somebody gives it
 * a state.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { LandingAction } from "../../../review/landing.js";

/** Every act the verb emits, exhaustive over the union by construction. */
const HEADED: Readonly<Record<LandingAction, true>> = {
  "answer-threads": true,
  "blocked-on": true,
  conflicting: true,
  draft: true,
  "no-queue": true,
  "opted-out": true,
  press: true,
  "pressed-not-queued": true,
  queued: true,
  "spawn-ci": true,
  "spawn-coderabbit": true,
  stacked: true,
  unknown: true,
};

const PAGE = fileURLToPath(new URL("../../../../site/lib/prViews.ts", import.meta.url));

/** The action words `PR_ACTION_ORDER` names a state for, read from the file's own text. */
function pageActions(): readonly string[] {
  const text = readFileSync(PAGE, "utf8");
  const start = text.indexOf("export const PR_ACTION_ORDER");
  const end = text.indexOf("] as const", start);
  return [...text.slice(start, end).matchAll(/\{ action: "([a-z-]+)"/g)].map((match) => match[1]!);
}

describe("the pull-requests page's act states", () => {
  it("names every act the verb emits", () => {
    const actions = pageActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(Object.keys(HEADED).filter((action) => !actions.includes(action))).toEqual([]);
  });

  it("names no act the verb does not emit", () => {
    const actions = pageActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((action) => !Object.hasOwn(HEADED, action))).toEqual([]);
  });
});
