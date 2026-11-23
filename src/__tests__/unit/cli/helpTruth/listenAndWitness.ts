/**
 * The help-truth tables' rows for `listen` and `witness` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { LISTEN_FLAG_NAMES, parseListenArgs } from "../../../../cli/commands/listen/core.js";
import { LISTEN_RECOVER_FLAG_NAMES, parseRecoverArgs } from "../../../../cli/commands/listen/recover.js";
import {
  LISTEN_ARM_FLAG_NAMES,
  LISTEN_DISARM_FLAG_NAMES,
  LISTEN_RECONCILE_FLAG_NAMES,
  LISTEN_STATUS_FLAG_NAMES,
  LISTEN_SUPERVISE_FLAG_NAMES,
  parseListenArmArgs,
  parseListenDisarmArgs,
  parseListenReconcileArgs,
  parseListenStatusArgs,
  parseListenSuperviseArgs,
} from "../../../../cli/commands/listen/supervise.js";
import {
  parseWitnessDispatchArgs,
  parseWitnessHelpArgs,
  parseWitnessListArgs,
  parseWitnessResumeArgs,
  parseWitnessReviseArgs,
  parseWitnessSettleArgs,
  parseWitnessStandDownArgs,
  WITNESS_FLAG_NAMES,
} from "../../../../cli/commands/witness/args.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  listen: LISTEN_FLAG_NAMES,
  "listen arm": LISTEN_ARM_FLAG_NAMES,
  "listen disarm": LISTEN_DISARM_FLAG_NAMES,
  "listen recover": LISTEN_RECOVER_FLAG_NAMES,
  "listen run": LISTEN_FLAG_NAMES,
  "listen reconcile": LISTEN_RECONCILE_FLAG_NAMES,
  "listen status": LISTEN_STATUS_FLAG_NAMES,
  "listen supervise": LISTEN_SUPERVISE_FLAG_NAMES,
  "witness dispatch": WITNESS_FLAG_NAMES["dispatch"]!,
  "witness help": WITNESS_FLAG_NAMES["help"]!,
  "witness list": WITNESS_FLAG_NAMES["list"]!,
  "witness resume": WITNESS_FLAG_NAMES["resume"]!,
  "witness revise": WITNESS_FLAG_NAMES["revise"]!,
  "witness settle": WITNESS_FLAG_NAMES["settle"]!,
  "witness stand-down": WITNESS_FLAG_NAMES["stand-down"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  listen: {
    "--channels": ["--channels", "D0SYN000001"],
    "--check": ["--check"],
    "--deadline-ms": ["--deadline-ms", "1786000000000"],
    "--dm-only": ["--dm-only"],
    "--emit": ["--emit"],
    "--follow": ["--follow"],
    "--heartbeat": ["--heartbeat", "arm-1"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--once": ["--once"],
    "--queue": ["--queue", "/tmp/listen-queue.jsonl"],
    "--thread-replies": ["--thread-replies", "C0ALERTS"],
  },
  "listen arm": {
    "--background": ["--background"],
    "--channels": ["--channels", "D0SYN000001"],
    "--dm-only": ["--dm-only"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--queue": ["--queue", "/tmp/listen-queue.jsonl"],
    "--thread-replies": ["--thread-replies", "C0ALERTS"],
  },
  "listen disarm": { "--home": ["--home", "/tmp"] },
  "listen reconcile": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "listen status": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "listen supervise": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--queue": ["--queue", "/tmp/listen-queue.jsonl"],
  },
  "listen recover": {
    "--bot-user": ["--bot-user", "U_BOT"],
    "--channels": ["--channels", "C_ONE,C_TWO"],
    "--deadline-ms": ["--scheduled", "--json", "--deadline-ms", "5000"],
    "--discover-channels": ["--discover-channels"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--scheduled": ["--scheduled", "--json"],
    "--since": ["--since", "7d"],
  },
  "witness dispatch": {
    "--channel": ["--channel", "C0SYN000000002"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--message-ts": ["--message-ts", "1789000000.000300"],
    "--model": ["--model", "opus"],
    "--text": ["--text", "the deploy finished cleanly"],
    "--thread-ts": ["--thread-ts", "1789000000.000050"],
  },
  "witness help": {
    "--channel": ["--channel", "C0SYN000000002"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1789000000.000300"],
    "--text": ["--text", "anything I can do to assist?"],
    "--thread-ts": ["--thread-ts", "1789000000.000050"],
    "--user": ["--user", "U0SYN000000002"],
  },
  "witness list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "witness resume": {
    "--home": ["--home", "/tmp"],
  },
  "witness settle": {
    "--as": ["--as", "nothing-checkable"],
    "--channel": ["--channel", "C0SYN000000002"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--message-ts": ["--message-ts", "1789000000.000300"],
    "--posted-ts": ["--as", "posted", "--posted-ts", "1789000002.000300"],
    "--thread-ts": ["--thread-ts", "1789000000.000050"],
    "--why": ["--why", "Datadog and CI agree"],
  },
  "witness revise": {
    "--because": ["--because", "https://example.slack.com/archives/C0SYN000000002/p1789000000000400"],
    "--correction": ["--correction", "it did not roll back."],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--wrong": ["--wrong", "the deploy rolled back"],
  },
  "witness stand-down": {
    "--channel": ["--channel", "C0SYN000000002"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1789000000.000300"],
    "--thread-ts": ["--thread-ts", "1789000000.000050"],
    "--why": ["--why", "told the bot it was in the way"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  listen: ({ fragment }) => parseListenArgs({ rest: [...fragment] }),
  "listen arm": ({ fragment }) => parseListenArmArgs({ rest: [...fragment] }),
  "listen disarm": ({ fragment }) => parseListenDisarmArgs({ rest: [...fragment] }),
  "listen recover": ({ fragment }) => parseRecoverArgs({ rest: [...fragment] }),
  "listen run": ({ fragment }) => parseListenArgs({ rest: [...fragment] }),
  "listen reconcile": ({ fragment }) => parseListenReconcileArgs({ rest: [...fragment] }),
  "listen status": ({ fragment }) => parseListenStatusArgs({ rest: [...fragment] }),
  "listen supervise": ({ fragment }) => parseListenSuperviseArgs({ rest: [...fragment] }),
  // `witness dispatch` and `settle` need the whole coordinate triple (and a model, an outcome), so each probe
  // rides a complete base; settle's names the witness by coordinates so a probed coordinate displaces one.
  "witness dispatch": ({ fragment }) =>
    parseWitnessDispatchArgs({
      rest: dedupeFlags({
        base: [
          "--channel",
          "C0SYN000000001",
          "--thread-ts",
          "1789000000.000100",
          "--message-ts",
          "1789000000.000200",
          "--text",
          "x",
          "--model",
          "sonnet",
        ],
        fragment,
      }),
    }),
  "witness help": ({ fragment }) =>
    parseWitnessHelpArgs({
      rest: dedupeFlags({
        base: [
          "--channel",
          "C0SYN000000001",
          "--thread-ts",
          "1789000000.000100",
          "--message-ts",
          "1789000000.000200",
          "--user",
          "U0SYN000000001",
          "--text",
          "x",
        ],
        fragment,
      }),
    }),
  "witness list": ({ fragment }) => parseWitnessListArgs({ rest: [...fragment] }),
  "witness resume": ({ fragment }) => parseWitnessResumeArgs({ rest: ["w-0123456789abcdef", ...fragment] }),
  "witness settle": ({ fragment }) =>
    parseWitnessSettleArgs({
      rest: dedupeFlags({
        base: [
          "--channel",
          "C0SYN000000001",
          "--thread-ts",
          "1789000000.000100",
          "--message-ts",
          "1789000000.000200",
          "--as",
          "nothing-checkable",
        ],
        fragment,
      }),
    }),
  "witness revise": ({ fragment }) =>
    parseWitnessReviseArgs({
      rest: [
        "w-0123456789abcdef",
        ...dedupeFlags({
          base: [
            "--wrong",
            "the deploy finished",
            "--correction",
            "it rolled back.",
            "--because",
            "https://example.slack.com/archives/C0SYN000000001/p1789000000000300",
          ],
          fragment,
        }),
      ],
    }),
  "witness stand-down": ({ fragment }) =>
    parseWitnessStandDownArgs({
      rest: dedupeFlags({
        base: [
          "--channel",
          "C0SYN000000001",
          "--thread-ts",
          "1789000000.000100",
          "--message-ts",
          "1789000000.000200",
          "--why",
          "x",
        ],
        fragment,
      }),
    }),
};

/** The rows for `listen` and `witness`. */
export const listenAndWitnessSlice: HelpTruthSlice = { guarded, probes, parsers };
