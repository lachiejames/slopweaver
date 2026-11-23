/**
 * `slopweaver profile guidance` — every source of the owner's guidance in rank order, each entry with its citation.
 *
 * The shell is here; what each source becomes is `src/profile/guidance.ts`, the order they rank in and the wire's
 * shape `src/profile/guidanceWire.ts`. Every source
 * is read at run time — `AGENTS.md` from the checkout the verb is invoked in, the class steers, standing asks and
 * owner profile from the store, the general rulings and the ruling gates from `$SLOPWEAVER_HOME`, and the memories
 * from every Claude Code project on this machine — so the repository holds no installation's guidance.
 *
 * The ruling gates are rebuilt from the run journals by `walkStandingGates`, which names a journal it could not
 * read whole as a gap: such a journal may hold a gate in force, so it is never read as one with none.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runningCheckoutRoot } from "#lib/gitRepo.js";

import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import type { OwnerProfileRead } from "../../../handover/currencyStandingEntries.js";
import { unexpiredGates } from "../../../handover/rulingGate.js";
import { walkStandingGates } from "../../../handover/rulingGateStore.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { loadGeneralRulings } from "../../../live/turn/generalRulingsStore.js";
import {
  askEntries,
  classSteerEntries,
  gateEntries,
  generalRulingState,
  guidanceLines,
  memoryState,
  profileState,
} from "../../../profile/guidance.js";
import { doctrineState, type GuidanceWire, guidanceWire } from "../../../profile/guidanceWire.js";
import { type StandingAskPort, standingAskPort } from "../../../profile/standingAskPort.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { PRODUCTION_STANDING_DEPS, readCorpora } from "../handover/currencyStandingRead.js";
import { talkHomeOf } from "../talk/args.js";
import { profileTail } from "./core.js";
import { parseProfileGuidanceArgs } from "./guidanceArgs.js";
import { PROFILE_GUIDANCE_USAGE } from "./guidanceUsage.js";

/** Everything the read touches outside itself, so a test points each source at a fixture. */
export interface GuidanceDeps {
  /** `AGENTS.md`'s text, or why it would not read. */
  readonly readDoctrine: () => string | { readonly why: string };
  readonly ledger: AutonomyLedgerPort;
  readonly asks: StandingAskPort;
  /** A `~/.claude/projects` directory, every `<project>/memory` corpus under it read. */
  readonly projectsDir: string;
  readonly readProfile: (args: { home: string }) => Promise<OwnerProfileRead>;
}

/** Why a thrown error happened, as one line. */
const whyOf = ({ error }: { error: unknown }): string => (error instanceof Error ? error.message : String(error));

/**
 * `AGENTS.md` at one checkout's root, or why it would not read.
 *
 * The verb passes the checkout it is INVOKED in (`runningCheckoutRoot`), never the one its code was loaded from: a
 * session in a worktree reads that worktree's doctrine, and a plugin mirror with no `.git` still resolves. A file
 * that is absent or will not read is a reason, which the wire draws as NOT READ, never as a doctrine with no rules.
 *
 * @param root the checkout root `AGENTS.md` sits at
 * @returns the file's text, or why it would not read
 */
export function readAgentsDocAt({ root }: { root: string }): string | { readonly why: string } {
  try {
    return readFileSync(join(root, "AGENTS.md"), "utf8");
  } catch (error) {
    return { why: `AGENTS.md would not read: ${whyOf({ error })}` };
  }
}

/**
 * Read every source once.
 *
 * @param home the Slopweaver home the rulings, gates and store are read under
 * @param nowIso the instant a gate's expiry is judged at, and the read is stamped with
 * @param deps where each source is read from
 * @returns the wire
 */
export async function readGuidance({
  home,
  nowIso,
  deps,
}: {
  home: string;
  nowIso: string;
  deps: GuidanceDeps;
}): Promise<GuidanceWire> {
  const doctrine = deps.readDoctrine();
  const records = await deps.ledger.readRecords({ home });
  const asks = await deps.asks.readActive({ home });
  const walk = walkStandingGates({ runsDir: stateHomePaths({ home }).runs });
  return guidanceWire({
    readAtIso: nowIso,
    states: {
      "class-steers": records.match(
        (value) => ({ entries: classSteerEntries({ records: value }), gaps: [], kind: "read" as const }),
        (error) => ({ kind: "unreadable" as const, why: error.message }),
      ),
      doctrine: typeof doctrine === "string" ? doctrineState({ text: doctrine }) : { kind: "unreadable", ...doctrine },
      "general-rulings": generalRulingState({ rulings: loadGeneralRulings({ home }) }),
      memories: memoryState({ corpora: readCorpora({ projectsDir: deps.projectsDir }) }),
      "owner-profile": profileState({ profile: await deps.readProfile({ home }) }),
      "ruling-gates":
        walk.kind === "read"
          ? {
              entries: gateEntries({ gates: unexpiredGates({ gates: walk.gates, nowIso }) }),
              gaps: walk.gaps,
              kind: "read",
            }
          : walk,
      "standing-asks": asks.match(
        (value) => ({ entries: askEntries({ asks: value }), gaps: [], kind: "read" as const }),
        (error) => ({ kind: "unreadable" as const, why: error.message }),
      ),
    },
  });
}

/** The production reads. */
function productionGuidanceDeps(): GuidanceDeps {
  return {
    asks: standingAskPort(),
    ledger: autonomyLedgerPort(),
    projectsDir: PRODUCTION_STANDING_DEPS.projectsDir,
    readDoctrine: () => readAgentsDocAt({ root: runningCheckoutRoot() }),
    readProfile: PRODUCTION_STANDING_DEPS.readProfile,
  };
}

/**
 * Run the `profile guidance` verb. A source that would not read is drawn as such and still exits 0: the console
 * draws a partial read, and refusing it would hide every source that did read.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileGuidance(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PROFILE_GUIDANCE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProfileGuidanceArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: PROFILE_GUIDANCE_USAGE });
    return EXIT_USAGE;
  }
  const wire = await readGuidance({
    deps: productionGuidanceDeps(),
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso: new Date().toISOString(),
  });
  if (parsed.value.json) {
    logger.out({ line: safeJsonStringify({ label: "profile guidance", value: wire }) });
    return EXIT_OK;
  }
  guidanceLines({ wire }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const profileGuidanceCommand = defineCommand({ run: runProfileGuidance });
