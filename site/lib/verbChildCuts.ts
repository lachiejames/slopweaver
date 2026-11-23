/**
 * The loss fields of the allowlisted verbs a `verb` tool call runs, read out of the child's own JSON: ONE entry per
 * verb whose fields were traced to the code that sets them (`src/talk/modelReads.ts` is the allowlist). Keyed by the
 * words the answer's `command` opens with, so a noun alias the gateway canonicalised reads the same.
 *
 * Closed on purpose. A field name means what ITS verb says: `refused` on an atlas coverage read is an exclusions
 * object, `omitted` and `unread` are subjects elsewhere, so reading a child by field name would misread the same way
 * `slack_unread` once did. A verb with no entry reads as whole here, and a cut stdout is a closing cut, never parsed.
 * Applied by `./toolCuts.ts`; `site/__tests__/unit/toolCuts.test.ts` fails on a field no source under `src/` declares.
 */
import type { CutProbe } from "./cutProbe";

/** A Datadog grouping that reached its own limit, so rarer groups exist (`src/datadog/investigate/run.ts`). */
const DATADOG_GROUPS: readonly CutProbe[] = [{ set: "truncated" }];

/** An atlas read's page stopped short of what matched (`src/cli/commands/atlas/readCore.ts`). */
const ATLAS_PAGE: readonly CutProbe[] = [{ set: "page.truncated" }];

/** Each traced verb, by the words its `command` opens with. */
export const VERB_CHILD_CUTS: Readonly<Record<string, readonly CutProbe[]>> = {
  "atlas jumpcloud read": ATLAS_PAGE,
  "atlas vanta read": ATLAS_PAGE,
  "calendar free": [{ each: "data.calendars", field: "error" }],
  "calendar list": [{ at: "data.complete", is: [false] }],
  "datadog apm": DATADOG_GROUPS,
  "datadog ci": DATADOG_GROUPS,
  "datadog dbm": DATADOG_GROUPS,
  "datadog logs": DATADOG_GROUPS,
  "datadog metrics": DATADOG_GROUPS,
  "datadog profiles": DATADOG_GROUPS,
  "datadog rum": DATADOG_GROUPS,
  "datadog tests": DATADOG_GROUPS,
  "drive list": [{ set: "data.more" }],
  "github pr standing": [{ set: "reviews.truncated" }, { at: "ci.verdict", is: ["unread"] }],
  "github run-log": [
    { each: "jobs", field: "log.annotationsDropped" },
    { each: "jobs", field: "log.linesTruncated" },
  ],
  "github search": [{ at: "coverage.kind", is: ["bounded"] }],
  "gmail list": [{ set: "data.more" }],
  "gmail read": [{ set: "data.unreadMessages" }],
  "hex output": [{ set: "truncated" }, { set: "omittedRows" }],
  "notion read": [{ set: "data.blocks.hasMore" }, { at: "data.nested.complete", is: [false] }],
  "talk cut-ins": [{ set: "gaps" }],
  "talk find-card": [{ set: "unreadable" }, { set: "unresolvedProbes" }],
  "transcripts last-turn": [{ set: "partsDropped" }],
};
