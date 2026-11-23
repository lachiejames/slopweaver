/**
 * `parkFailureLines` — what `handover park` prints for each way it stops, and whether it says anything was
 * written. The act itself (socket, append, close) is `parkRun.ts`'s and proved against a live fleet.
 */
import { describe, expect, it } from "vitest";

import { parkFailureLines } from "../../../../../cli/commands/handover/parkFailure.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { ParkSeatErrors } from "../../../../../handover/parkPolicy.js";
import { hatchFor } from "../../../../../hatch/lookup.js";

const HATCH = hatchFor({ id: "park-running-seat" });
const CALL_FAILED = CmuxErrors.callFailed({ cmuxCode: "E", message: "gone", method: "workspace.close" });

describe("parkFailureLines", () => {
  it("says nothing was written when the close failed before the append", () => {
    expect(
      parkFailureLines({ failure: { error: CALL_FAILED, journalled: false, kind: "cmux" }, hatch: HATCH, slug: "s" }),
    ).toEqual(["handover park: nothing written — cmux workspace.close failed (E): gone"]);
  });

  it("names the run journalled parked when only the close failed", () => {
    expect(
      parkFailureLines({ failure: { error: CALL_FAILED, journalled: true, kind: "cmux" }, hatch: HATCH, slug: "s" }),
    ).toEqual([
      "handover park: s is journalled parked but the close failed — cmux workspace.close failed (E): gone; close it with slopweaver cmux close",
    ]);
  });

  it("refuses the pinned chair by name", () => {
    expect(
      parkFailureLines({ failure: { kind: "pinned", workspaceRef: "workspace:1" }, hatch: HATCH, slug: "s" }),
    ).toEqual([
      "handover park: workspace:1 is the pinned chair, which is never parked — name the seat with --workspace",
    ]);
  });

  it("passes a seat-choice error through", () => {
    const error = ParkSeatErrors.notFound({ detail: "--workspace workspace:9 names no live workspace" });

    expect(parkFailureLines({ failure: { error, kind: "seat" }, hatch: HATCH, slug: "s" })).toEqual([
      "handover park: no live seat to park: --workspace workspace:9 names no live workspace",
    ]);
  });

  it("names the run journalled parked and the screen verdict when a foreign seat was held open", () => {
    expect(
      parkFailureLines({
        failure: { journalled: true, kind: "held", verdict: "unproven", workspaceRef: "workspace:12" },
        hatch: HATCH,
        slug: "s",
      }),
    ).toEqual([
      "handover park: s is journalled parked but workspace:12 was held open — cmux wants force for its running process, and its screen no longer proves Claude idle at a prompt (unproven); close it with slopweaver cmux close once it is at rest",
    ]);
  });

  it("prints the owner-words refusal whole, adding nothing, when the owner spoke over the card before the append", () => {
    const lines = ["slopweaver handover park blocked because …", '  - call:c#s-1 (…): "I have saved it"'];
    expect(parkFailureLines({ failure: { kind: "owner-words", lines }, hatch: HATCH, slug: "s" })).toEqual(lines);
  });

  it("says nothing closed when the journal moved", () => {
    expect(parkFailureLines({ failure: { kind: "journal", message: "moved" }, hatch: HATCH, slug: "s" })).toEqual([
      "handover park: nothing closed — moved",
    ]);
  });

  it("renders a running seat as the four-line hatch refusal naming what the screen shows", () => {
    const lines = parkFailureLines({
      failure: { kind: "mid-turn", shows: "a busy spinner", workspaceRef: "workspace:7" },
      hatch: HATCH,
      slug: "s",
    });

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("workspace:7 shows a busy spinner");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT=1");
  });
});
