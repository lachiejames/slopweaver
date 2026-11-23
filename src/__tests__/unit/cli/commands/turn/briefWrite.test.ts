/*
 * The `turn brief` write tail, called directly: an admitted target and a routing input become a brief file
 * on disk under an explicit temporary home, read back through the real brief store.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BriefTarget } from "../../../../../cli/commands/turn/briefTarget.js";
import { writeAndRenderBrief } from "../../../../../cli/commands/turn/briefWrite.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { readBrief } from "../../../../../live/turn/briefStore.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import type { SkippedCapability, SourceCapability } from "../../../../../route/profile.js";

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: {
      ownerAddressingText: "what did acme decide about ABC-1?",
      structuralMetadata: [],
    },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
  historicalCapabilities: [],
};

const TARGET: BriefTarget = {
  channel: "C1",
  messageTs: "1.1",
  surface: "channel",
  text: "what did acme decide about ABC-1?",
  threadTs: "1.1",
  userId: "U_ASKER",
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("writeAndRenderBrief", () => {
  it("writes the brief the target and routing input describe, and exits OK", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-brief-write-"));
    dirs.push(home);
    const path = join(home, "brief.json");
    const skippedCapabilities: readonly SkippedCapability[] = [];
    const unavailableCapabilities: readonly SourceCapability[] = [];

    const code = writeAndRenderBrief({
      home,
      path,
      ridesOn: undefined,
      routingInput: ROUTING_INPUT,
      skippedCapabilities,
      startedRef: undefined,
      target: TARGET,
      unavailableCapabilities,
    });

    expect(code).toBe(EXIT_OK);
    const read = readBrief({ path });
    expect(read.isOk()).toBe(true);
    const brief = unwrap(read);
    expect(brief.question).toBe("what did acme decide about ABC-1?");
    expect(brief.channel).toBe("C1");
    expect(brief.userId).toBe("U_ASKER");
  });
});
