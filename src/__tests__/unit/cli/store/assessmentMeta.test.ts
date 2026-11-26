/**
 * The `store` stored-row assessment verbs' manifest rows against what each verb really is: each usage names exactly
 * the flags its real parser advertises, each example parses, and only the recording verb writes, to this machine
 * alone.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  parseStoreAssessmentDueArgs,
  parseStoreAssessmentRecordArgs,
  STORE_ASSESSMENT_DUE_FLAG_NAMES,
  STORE_ASSESSMENT_RECORD_FLAG_NAMES,
} from "../../../../cli/commands/store/assessmentArgs.js";
import {
  STORE_ASSESSMENT_DUE_USAGE,
  STORE_ASSESSMENT_RECORD_USAGE,
} from "../../../../cli/commands/store/assessmentUsage.js";
import { assessmentVerbs } from "../../../../cli/manifests/storeAssessmentMeta.js";

/** Every `--flag` a usage line names, sorted. */
const flagsNamed = ({ usage }: { usage: string }): readonly string[] =>
  [...new Set(usage.match(/--[a-z][a-z-]*/g))].toSorted();

describe("assessmentVerbs", () => {
  it("holds the two verbs, reading and recording, and only the recording verb writes local state", () => {
    expect(Object.keys(assessmentVerbs)).toEqual(["assessment-due", "assessment-record"]);
    const rows = Object.values(assessmentVerbs);
    expect(rows.map((row) => row.meta.effect)).toEqual(["none", "local-state"]);
    expect(rows.map((row) => row.meta.doorRouted)).toEqual([false, false]);
  });

  it("quotes each verb's usage leaf", () => {
    expect(assessmentVerbs["assessment-due"]!.meta.usage).toBe(STORE_ASSESSMENT_DUE_USAGE);
    expect(assessmentVerbs["assessment-record"]!.meta.usage).toBe(STORE_ASSESSMENT_RECORD_USAGE);
  });

  it("names exactly each parser's advertised flags in its usage", () => {
    expect(flagsNamed({ usage: STORE_ASSESSMENT_DUE_USAGE })).toEqual([...STORE_ASSESSMENT_DUE_FLAG_NAMES].toSorted());
    expect(flagsNamed({ usage: STORE_ASSESSMENT_RECORD_USAGE })).toEqual(
      [...STORE_ASSESSMENT_RECORD_FLAG_NAMES].toSorted(),
    );
  });

  it("gives each verb an example its own parser accepts", () => {
    expect(unwrap(parseStoreAssessmentDueArgs({ rest: ["--json"] })).json).toBe(true);
    expect(
      unwrap(parseStoreAssessmentRecordArgs({ rest: ["--verdicts-file", "./verdicts.json", "--json"] })).verdictsFile,
    ).toBe("./verdicts.json");
    expect(assessmentVerbs["assessment-due"]!.meta.example).toBe("slopweaver store assessment-due --json");
    expect(assessmentVerbs["assessment-record"]!.meta.example).toBe(
      "slopweaver store assessment-record --verdicts-file ./verdicts.json --json",
    );
  });
});
