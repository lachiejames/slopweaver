/*
 * What the `parseAnswerArm` test files share: the empty bare-reference context, a minimal valid `answer` arm,
 * and the two hatch-grant environments, each under a `mkdtempSync` home removed by the `afterEach` that
 * `useHomes()` registers. They moved here when `parseAnswerArm.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import type { BareRefContext } from "../../../../../outbound/linkify/bareRefs.js";
import { grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

export const NO_CONTEXT: BareRefContext = { repos: [] };

const homes: string[] = [];

/**
 * Register the `afterEach` that removes every home minted since the last case. Call it once per test file.
 *
 * @returns the list a case may push its own temp homes into, removed by the same `afterEach`
 */
export function useHomes(): string[] {
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  return homes;
}

/**
 * An environment holding a live grant for each named hatch, under a fresh temp home removed after the test.
 *
 * @returns the environment carrying the grant's session
 */
export function envGranting({ hatchIds }: { hatchIds: readonly string[] }): Readonly<Record<string, string>> {
  const home = mkdtempSync(join(tmpdir(), "parse-answer-arm-"));
  homes.push(home);
  return grantedEnv({ hatchIds, home });
}

/**
 * An environment naming a session and an empty home, carrying `variables` beside it but no grant.
 *
 * @returns the session environment with `variables` spread over it
 */
export function envWithoutGrant({
  variables,
}: {
  variables: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const home = mkdtempSync(join(tmpdir(), "parse-answer-arm-"));
  homes.push(home);
  return { ...grantSessionEnv({ home }), ...variables };
}

/**
 * A minimal valid `answer` arm — conversation-grounded, no citations, so only `body`/`index`/`lead` vary.
 *
 * @returns the raw arm, unparsed
 */
export function answerRaw({ bodyText, leadText }: { bodyText: string; leadText: string }): unknown {
  return {
    body: [{ runs: [{ text: bodyText, type: "text" }], type: "paragraph" }],
    citations: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "no live check needed" },
        premiseChecks: [],
        read: [],
      },
      kind: "conversation",
      provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
      reason: "context and judgement alone were sufficient",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: leadText,
  };
}
