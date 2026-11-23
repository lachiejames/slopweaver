/*
 * Whether the owner's microphone carries them talking: open, and clear of both bars. It is one predicate because,
 * measured, the orb and the resume answered it differently, and the voice slept under ZZZ until the owner spoke.
 */
import { describe, expect, it } from "vitest";

import { HEARING_LEVEL, HEARING_RMS, micAudible } from "../../lib/micAudible";
import { HEARING_LEVEL as TALKING_LEVEL, HEARING_RMS as TALKING_RMS } from "../../lib/voiceTalking";

describe("micAudible", () => {
  it("is the owner at both bars, and not a hair under either, nor muted", () => {
    expect([
      micAudible({ micLevel: HEARING_LEVEL, micRms: HEARING_RMS, muted: false }),
      micAudible({ micLevel: HEARING_LEVEL - 0.001, micRms: HEARING_RMS, muted: false }),
      micAudible({ micLevel: HEARING_LEVEL, micRms: HEARING_RMS - 0.001, muted: false }),
      micAudible({ micLevel: HEARING_LEVEL, micRms: HEARING_RMS, muted: true }),
    ]).toEqual([true, false, false, false]);
  });

  // Repro, from the home: `grep -o '(mic 0.311 rms 0.004' talk/calls/281228ba-*.jsonl` — nobody spoke.
  it("is never the owner's quiet room, loud on the spectral level alone, and is their speech in it", () => {
    expect([
      micAudible({ micLevel: 0.311, micRms: 0.004, muted: false }),
      micAudible({ micLevel: 0.311, micRms: 0.05, muted: false }),
    ]).toEqual([false, true]);
  });

  it("keeps the bars the orb has always read, under their old names", () => {
    expect([TALKING_LEVEL, TALKING_RMS]).toEqual([HEARING_LEVEL, HEARING_RMS]);
    expect([HEARING_LEVEL, HEARING_RMS]).toEqual([0.04, 0.02]);
  });
});
