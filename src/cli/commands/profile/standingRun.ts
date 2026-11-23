/**
 * `slopweaver profile standing` — their standing asks: list them, record one off its anchor, withdraw one.
 *
 * The shell is here; what an ask is and how the journal folds is `src/profile/standingAsks.ts`, and where it lives
 * is the store, reached through `src/profile/standingAskPort.ts`. Their words are read by `handover quote --anchor`'s
 * own reader (`../handover/quoteAttachRead.ts`), so a standing ask's quote is judged exactly as a row's is — a relay
 * typed into the supervisor, a turn outside the chair, a suggestion they only accepted, each refused the same way.
 */
import { join } from "node:path";

import type { Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { StandingAskError } from "../../../profile/standingAskErrors.js";
import { type StandingAskPort, standingAskPort } from "../../../profile/standingAskPort.js";
import type { StandingAsk } from "../../../profile/standingAsks.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { wordsToAttach } from "../handover/quoteAttachRead.js";
import { talkHomeOf } from "../talk/args.js";
import { profileTail } from "./core.js";
import { type ProfileStandingArgs, parseProfileStandingArgs } from "./standingArgs.js";
import { PROFILE_STANDING_USAGE } from "./standingUsage.js";

/** The list as `--json` publishes it: the active asks, or the one reason the register does not read. */
export type StandingAskWire =
  | { readonly kind: "read"; readonly active: readonly StandingAsk[] }
  | { readonly kind: "defect"; readonly why: string };

/**
 * The list as lines: one head per ask, their words beneath it.
 *
 * @param active the asks standing now
 * @returns the lines
 */
export function standingAskLines({ active }: { active: readonly StandingAsk[] }): readonly string[] {
  if (active.length === 0) {
    return ["no standing asks recorded — `slopweaver profile standing add` records one off its anchor"];
  }
  return active.flatMap((ask) => [
    `${ask.id}  covers ${ask.covers.join(", ")}  ·  ${ask.quote.where} ${ask.quote.atIso.slice(0, 16)}Z  ·  ${ask.quote.anchor}`,
    `    ${ask.quote.words}`,
  ]);
}

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`, where a transcript anchor's session lives
 * @param nowIso the instant a write is stamped with
 * @param port where the register is read and written — the store, or a test's fake
 * @param out where each line goes
 * @returns 0 on a list or a recorded write, 1 when the register or the anchor would not read or the write is refused
 */
export async function profileStanding({
  args,
  home,
  claudeHome,
  nowIso,
  port,
  out,
}: {
  args: ProfileStandingArgs;
  home: string;
  claudeHome: string;
  nowIso: string;
  port: StandingAskPort;
  out: (line: string) => void;
}): Promise<number> {
  if (args.mode === "list") {
    return listStanding({ active: await port.readActive({ home }), json: args.json, out });
  }
  if (args.mode === "withdraw") {
    const written = await port.write({
      home,
      request: { id: args.id, kind: "withdraw", reason: args.reason, withdrawnAtIso: nowIso },
    });
    if (written.isErr()) {
      out(`profile standing withdraw: ${written.error.message}`);
      return EXIT_ERROR;
    }
    out(`withdrew ${args.id}`);
    return EXIT_OK;
  }
  return addStanding({ anchor: args.anchor, claudeHome, covers: args.covers, home, id: args.id, nowIso, out, port });
}

/** The list, as lines or as its `--json` document. */
function listStanding({
  active,
  json,
  out,
}: {
  active: Result<readonly StandingAsk[], StandingAskError>;
  json: boolean;
  out: (line: string) => void;
}): number {
  if (json) {
    const wire: StandingAskWire = active.match(
      (asks): StandingAskWire => ({ active: asks, kind: "read" }),
      (error): StandingAskWire => ({ kind: "defect", why: error.message }),
    );
    // A register that does not read is a reading the console draws on every card it would have quoted, so it exits 0.
    out(safeJsonStringify({ label: "profile standing", value: wire }));
    return EXIT_OK;
  }
  if (active.isErr()) {
    out(`profile standing: ${active.error.message}`);
    return EXIT_ERROR;
  }
  standingAskLines({ active: active.value }).forEach((line) => {
    out(line);
  });
  return EXIT_OK;
}

/** Record one ask, their words read off its anchor, judged against the register as the write lock holds it. */
async function addStanding({
  anchor,
  claudeHome,
  covers,
  home,
  id,
  nowIso,
  out,
  port,
}: {
  anchor: string;
  claudeHome: string;
  covers: readonly string[];
  home: string;
  id: string;
  nowIso: string;
  out: (line: string) => void;
  port: StandingAskPort;
}): Promise<number> {
  const quote = wordsToAttach({ anchor, home, projectsDir: join(claudeHome, "projects") });
  if ("refusals" in quote) {
    quote.refusals.forEach((line) => {
      out(`profile standing add: ${line}`);
    });
    return EXIT_ERROR;
  }
  const ask: StandingAsk = { covers, id, quote, recordedAtIso: nowIso };
  const written = await port.write({ home, request: { ask, kind: "add" } });
  if (written.isErr()) {
    out(`profile standing add: ${written.error.message}`);
    return EXIT_ERROR;
  }
  out(`recorded ${ask.id}, covering ${ask.covers.join(", ")}:`);
  out(`    ${quote.words}`);
  return EXIT_OK;
}

/**
 * Run the `profile standing` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileStanding(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PROFILE_STANDING_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProfileStandingArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: PROFILE_STANDING_USAGE });
    return EXIT_USAGE;
  }
  let nowIso = new Date().toISOString();
  if (parsed.value.now !== undefined) {
    nowIso = new Date(parsed.value.now).toISOString();
  }
  return profileStanding({
    args: parsed.value,
    claudeHome: claudeHomeDir(),
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso,
    out: (line) => {
      logger.out({ line });
    },
    port: standingAskPort(),
  });
}

export const profileStandingCommand = defineCommand({ run: runProfileStanding });
