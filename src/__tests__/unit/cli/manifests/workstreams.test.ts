import { describe, expect, it } from "vitest";

import {
  WORKSTREAMS_CANDIDATES_PUT_USAGE,
  WORKSTREAMS_CANDIDATES_USAGE,
  WORKSTREAMS_DEFINE_USAGE,
  WORKSTREAMS_LIST_USAGE,
  WORKSTREAMS_LOOP_IN_USAGE,
  WORKSTREAMS_PUT_USAGE,
  WORKSTREAMS_REACT_USAGE,
} from "../../../../cli/commands/workstreams/usage.js";
import { workstreamsManifest } from "../../../../cli/manifests/workstreams.js";

describe("workstreamsManifest", () => {
  it("prints each verb's own usage", () => {
    expect(workstreamsManifest["list"]!.meta.usage).toBe(WORKSTREAMS_LIST_USAGE);
    expect(workstreamsManifest["put"]!.meta.usage).toBe(WORKSTREAMS_PUT_USAGE);
    expect(workstreamsManifest["candidates"]!.meta.usage).toBe(WORKSTREAMS_CANDIDATES_USAGE);
    expect(workstreamsManifest["candidates-put"]!.meta.usage).toBe(WORKSTREAMS_CANDIDATES_PUT_USAGE);
    expect(workstreamsManifest["react"]!.meta.usage).toBe(WORKSTREAMS_REACT_USAGE);
    expect(workstreamsManifest["define"]!.meta.usage).toBe(WORKSTREAMS_DEFINE_USAGE);
    expect(workstreamsManifest["loop-in"]!.meta.usage).toBe(WORKSTREAMS_LOOP_IN_USAGE);
  });
});
