/*
 * The shared harness for the `turn dispatch` test files: the throwaway homes they mint, the brief-and-decision home
 * `fixture()` writes, and the read of a home's newest ask-lifecycle event. Each test file registers
 * `removeFixtureDirs` with `afterEach`. It moved here when `dispatch.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AskLifecycleEvent, parseAskLifecycleLog } from "../../../../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../../../../live/ask/store.js";
import { buildTurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { ROUTING_INPUT } from "./fixtures.js";

/**
 * The MOST RECENT ask-lifecycle event a real home's log holds — every case here appends a `captured` one
 * first now.
 *
 * Generic, defaulting to the real `AskLifecycleEvent` union: most callers here only assert a couple of
 * fields common to a specific event kind, so the type parameter lets them ask for exactly that ad-hoc shape
 * instead of casting the result at every call site.
 *
 * @returns the newest event, typed as the shape the caller names, or undefined for an empty log
 */
export function lastLifecycleEvent<T = AskLifecycleEvent>({ home }: { home: string }): T | undefined {
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  // `as`: the caller supplies a shape it already knows this specific test's event carries.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return events.at(-1) as T | undefined;
}

/** Every fixture directory these tests have minted, so a test file's `afterEach` can remove them. */
export const fixtureDirs: string[] = [];

/** Remove every fixture directory minted since the last call; each test file registers it with `afterEach`. */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * A fresh temp home admitting exactly `U0OWNER`, with a v6 brief + decision file written for one ask.
 *
 * @returns the brief and decision paths written, and the home they sit in
 */
export function fixture({
  decision,
  routingInput = ROUTING_INPUT,
  started,
}: {
  decision:
    | RespondDecision
    | { schemaVersion: 1; response: "no-response"; confidence: "high"; rationale: string; exclude?: boolean }
    | { schemaVersion: 1; response: "for-a-human"; confidence: "high"; rationale: string };
  routingInput?: RoutingJudgementInput;
  started?: { turnId: string; workingTs: string } | undefined;
}): { readonly briefPath: string; readonly decisionPath: string; readonly home: string } {
  // The temp dir is the home, but the brief and decision are this fixture's own scratch files rather than
  // state-home layout, so they are joined onto `dir` and only `stateHomePaths` derives a home path.
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-"));
  fixtureDirs.push(dir);
  writeFileSync(stateHomePaths({ home: dir }).respondersJson, JSON.stringify(["U0OWNER"]), "utf8");
  const briefPath = join(dir, "brief.json");
  const decisionPath = join(dir, "decision.json");
  const brief = buildTurnRoutingBrief({
    channel: "C1",
    messageTs: "1.1",
    question: "what are my open PRs?",
    routingInput,
    ...(started === undefined ? {} : { started }),
    surface: "channel",
    threadTs: "1.1",
    unavailableCapabilities: [],
    userId: "U0OWNER",
  });
  writeFileSync(briefPath, JSON.stringify(brief), "utf8");
  writeFileSync(decisionPath, JSON.stringify(decision), "utf8");
  return { briefPath, decisionPath, home: dir };
}
