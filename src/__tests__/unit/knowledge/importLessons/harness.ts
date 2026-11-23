/*
 * What the import-lessons test files share: one recording id, the register line an import key is built over and
 * its digest, and a builder for one decoded row of the old register. They moved here when the import projection's
 * tests were split by behaviour.
 */
import { createHash } from "node:crypto";

import type { LessonRow } from "../../../../knowledge/types.js";

export const RECORDING_ID = "33333333-2222-3333-4444-555555555555";
/** The SHA-256 of { LINE}, which is what an import key is built over. */
export const LINE = '{"claim":"one"}';

/** { LINE}'s own digest, which is the first half of every key built over it. */
export const DIGEST = createHash("sha256").update(LINE).digest("hex");

/**
 * One decoded row of the old register.
 *
 * @returns the decoded lesson, every field the test did not name at its default
 */
export const lesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-0000000000009003",
  learner: "fleet",
  recordedAtIso: "2026-09-07T22:23:24.368Z",
  run: "owner-steer-6-sep",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});
