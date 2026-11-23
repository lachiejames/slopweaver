/**
 * The judging brief's FIXED blocks: text with no inputs that `./brief.ts`'s `renderTurnRoutingBrief` prints
 * in every brief, in this order — the decision shape, the `truthMode` contract, and the measurement rule.
 *
 * Their own module because they are the seam in that renderer that carries no data at all: the brief's
 * schema, decoder and data-driven sections stay in `./brief.ts`, and the file-size ratchet is what made it
 * worth cutting here.
 */

/**
 * The `RoutingDecision` JSON the judging session must write, and the one rule binding its `needs`.
 *
 * @returns the lines, in order
 */
export function decisionShapeLines(): readonly string[] {
  return [
    "JUDGE THIS ASK — respond, or not — and write ONE `RoutingDecision` JSON to a file:",
    "",
    '  {"schemaVersion": 1, "response": "no-response", "confidence": "high", "rationale": "why no reply is owed"}',
    "  — or, when a reply IS owed but a PERSON should give it and the bot stays out —",
    '  {"schemaVersion": 1, "response": "for-a-human", "confidence": "high", "rationale": "why a person should answer"}',
    "  — or —",
    '  {"schemaVersion": 1, "response": "respond", "tier": "inline" | "read-only-subagent" | "fresh-visible-session",',
    '   "needs": [{"capabilityId": "...", "requirement": "required" | "optional", "reason": "..."}],',
    '   "truthMode": "current" | "history" | "none",',
    '   "confidence": "low" | "medium" | "high", "rationale": "why this tier and these needs",',
    '   "model": "opus" | "sonnet"   (optional; fresh-visible-session only — pins the worker at boot, Opus when absent)}',
    "",
    "Every `needs[].capabilityId` must name a capability listed above — AVAILABLE or HISTORICAL — never a",
    "reserved `corpus` id, and never an UNAVAILABLE one.",
    "",
  ];
}

/**
 * The `truthMode` contract — what each value claims, and which legs can carry it.
 *
 * @returns the lines, in order
 */
export function truthModeLines(): readonly string[] {
  return [
    "`truthMode` says what kind of claim your answer will make, and it is CHECKED against your needs:",
    '  - "current"  — the answer asserts present state. It must name at least one AVAILABLE (current-truth)',
    "                 leg. Historical legs alone are REFUSED: the world model records what WAS true, so it",
    "                 can inform a current claim but never establish one on its own.",
    '  - "history"  — the answer is about what was said, decided or recorded. A historical leg can carry this',
    "                 alone, because that is exactly what it holds.",
    '  - "none"     — no evidence is claimed (a greeting, an acknowledgement). `needs` must be empty.',
    "",
    "So a question about what is true NOW that the world model can speak to should name BOTH: the world",
    "model to find the candidate, and the live leg that checks whether it still holds.",
    "",
  ];
}

/**
 * The MEASUREMENT rule, told to the composer before it writes rather than discovered as a refusal.
 *
 * `../../outbound/assistant/measuredFigures.ts` refuses an answer that asserts a figure with no measurement
 * behind it, and its criterion was set by measuring 180 real answers. A composer meeting it for the first
 * time as a parse failure has to rewrite what it already wrote, which is the loop this repo's typed forms
 * exist to avoid — the same reason `./brief.ts`'s `proposalAskLines` names `premiseChecks` in the brief
 * rather than leaving `validateAnswerForDispatch` to say no.
 *
 * @returns the lines, in order
 */
export function measuredFigureLines(): readonly string[] {
  return [
    "EVERY FIGURE YOU ASSERT CARRIES ITS OWN REPRO. A measured comment in this repo's CODE already has to",
    "carry the command that reproduces it inline; an answer is now the same. Your `answer` form takes a",
    "`measurements` array, and each entry is `{figures, repro, takenAtIso}` — the figures ONE command",
    "produced, that command, and when you ran it. One entry may carry a whole table's numbers.",
    "",
    "What counts as a figure is NARROW, so this is cheap: a thousands-separated number (`1,771`), a bare",
    "three- or four-digit number (`227`), or a percentage, decimals included (`49%`, `98.7%`). A small",
    "count a reader can count against",
    "your own table, a year, a clock, a version, an id, a bare run of five or more digits, and anything you",
    "write as a LINK to whatever produced it are all outside the rule and need no entry.",
    "",
    "Two more refusals have NO way past them, and together they are what keeps the array honest: a figure",
    "you measure but never assert, and a figure covered by two entries. One figure, one repro; do not pad.",
    "",
  ];
}
