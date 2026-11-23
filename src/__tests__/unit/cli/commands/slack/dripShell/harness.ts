/*
 * The shared harness for the as-me drip shell tests: a fake write api and a full `SlackWriteDeps`, plus the argv
 * builders and the throwaway-home helpers every one of those test files leans on. The fakes themselves are built
 * by seam in `harnessSeams.ts` and `harnessActs.ts`; this file resolves the caller's options once and assembles them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "../../../../../../lib/result.js";
import { AskedBeforeErrors } from "../../../../../../outbound/slack/askedBeforeErrors.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { PROMPT_DM_IS_OWNERS } from "../ownDmFakes.js";
import { ioSeams, releaseSeams } from "./harnessActs.js";
import { gateSeams, identitySeams } from "./harnessSeams.js";
import type { Harness, HarnessOptions, HarnessRecord, ResolvedHarnessOptions } from "./harnessTypes.js";

export { type Harness, RELEASE_SELF } from "./harnessTypes.js";

const DRIP = JSON.stringify({
  kind: "drip",
  messages: [
    { runs: [{ text: "Shipped the compaction pass.", type: "text" }] },
    { runs: [{ text: "Docs to follow tomorrow.", type: "text" }] },
  ],
});

// Every fixture directory the drip tests have minted, so a test file's `afterEach` can remove them.
const fixtureDirs: string[] = [];

/**
 * Remove every fixture directory minted since the last call; each drip test file registers it with `afterEach`.
 *
 * @returns nothing.
 */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Mint a throwaway home that `removeFixtureDirs` will remove.
 *
 * @returns the new directory's path.
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr51-shell-"));
  fixtureDirs.push(dir);
  return dir;
}

function emptyResolution(): MentionResolution {
  return {
    groupAddresses: new Map(),
    heldRequested: [],
    memberLookups: new Map(),
    resolved: new Map(),
    roster: { addressableKeys: 2, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
  };
}

/**
 * A roster that knows exactly one Slack id, so a fixture can tell a real mention from a fabricated one.
 *
 * @returns a resolution holding only that id.
 */
export function resolutionKnowing({ id }: { id: string }): MentionResolution {
  return {
    ...emptyResolution(),
    resolved: new Map([[id, { origin: "member" as const, slackId: id }]]),
  };
}

// Every default is applied here, once, so each seam builder reads the same snapshot of what the caller asked for.
// Every option is named and read from the caller exactly once, as the original parameter destructuring did.
function resolveHarnessOptions({ input }: { input: HarnessOptions }): ResolvedHarnessOptions {
  const {
    stdin = DRIP,
    userToken = "xoxp-test",
    exactVoiceRules = [],
    paragraphSpacing = false,
    wallRun = async () => ok({ length: 0 }),
    conversationSurface = async () => "private-channel" as const,
    proveRender = async () => ({ issues: [], kind: "checked" as const }),
    highStakes = ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
    fleetHistory = async () => ({ kind: "read" as const, priors: [] }),
    resolveMentions = async () => ok(emptyResolution()),
    draftLog = [],
    releaseConversation = [],
    priorRead = err(AskedBeforeErrors.priorUnreadable({ cause: "no earlier ask seeded", permalink: "unseeded" })),
    extraEnv = {},
    channelAccess = { isMember: true, name: "dev", surface: "public-channel" },
    ownDm = PROMPT_DM_IS_OWNERS,
    autonomy = memoryAutonomyLedgerPort(),
    door = memoryDoorLedger(),
    failOn,
    refuseOn,
    override,
    grants,
    unreadableMedia,
    renderProofChannel,
    joinRefusal,
  } = input;
  return {
    failOn,
    refuseOn,
    override,
    grants,
    unreadableMedia,
    renderProofChannel,
    joinRefusal,
    stdin,
    userToken,
    exactVoiceRules,
    paragraphSpacing,
    wallRun,
    conversationSurface,
    proveRender,
    highStakes,
    fleetHistory,
    resolveMentions,
    draftLog,
    releaseConversation,
    priorRead,
    extraEnv,
    channelAccess,
    ownDm,
    autonomy,
    door,
  };
}

/**
 * Build the fake write api and the full dependency set one drip run is handed, with a recorder for each seam.
 *
 * @returns the deps plus everything the run recorded.
 */
export function harness(input: HarnessOptions = {}): Harness {
  const options = resolveHarnessOptions({ input });
  const record: HarnessRecord = {
    draftEvents: [],
    joins: [],
    mediaReads: [],
    out: [],
    painPoints: [],
    sends: [],
    uploaded: [],
    userHomes: [],
  };
  return {
    autonomy: options.autonomy,
    door: options.door,
    deps: {
      ...identitySeams({ options, record }),
      ...gateSeams({ options }),
      ...ioSeams({ options, record }),
      ...releaseSeams({ options, record }),
    },
    ...record,
  };
}

/**
 * The as-me form invocation's argv.
 *
 * @returns the argv for `runSlackWrite`.
 */
export function argv({
  home,
  extra = [],
  channel = "C1",
}: {
  home: string;
  extra?: readonly string[];
  channel?: string;
}): readonly string[] {
  return ["--as", "me", "--channel", channel, "--form", "-", "--home", home, "--shape", "top-level", ...extra];
}

/**
 * The raw escape hatch's argv — the same invocation with `--body` where `--form` was.
 *
 * @returns the argv for `runSlackWrite`.
 */
export function rawBodyArgv({ home, extra = [] }: { home: string; extra?: readonly string[] }): readonly string[] {
  return ["--as", "me", "--channel", "C1", "--body", "-", "--home", home, "--shape", "top-level", ...extra];
}
