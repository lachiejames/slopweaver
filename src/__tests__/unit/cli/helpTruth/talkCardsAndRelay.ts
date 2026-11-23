/**
 * The help-truth tables' rows for `talk`'s card-landing, relay and transcript verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseTranscriptArgs, TALK_TRANSCRIPT_FLAG_NAMES } from "../../../../cli/commands/talk/callArgs.js";
import { parseLandArgs, TALK_LAND_FLAG_NAMES } from "../../../../cli/commands/talk/cardArgs.js";
import { parseRelayArgs, TALK_RELAY_FLAG_NAMES } from "../../../../cli/commands/talk/relayArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { CONSOLE_ORIGIN, TRANSCRIPT_BASE } from "./sharedProbes.js";

/** A valid `talk relay`: `--turn` and `--say` (or `--read-after`, or `--words-alone`) are required, so every probe carries them. */
const TALK_RELAY_BASE: readonly string[] = [
  "--turn",
  "a0000088-0000-4000-8000-000000000095",
  "--say",
  "the owner asked for the queue's oldest blocked row",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "talk relay": TALK_RELAY_FLAG_NAMES,
  "talk land": TALK_LAND_FLAG_NAMES,
  "talk transcript": TALK_TRANSCRIPT_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // `--card`, `--words`, `--anchor` and `--decided` are required, so every fragment carries them.
  "talk land": {
    "--anchor": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
    ],
    "--card": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
    ],
    "--decided": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
    ],
    "--dir": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
      "--dir",
      "/tmp/board",
    ],
    "--home": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
      "--home",
      "/tmp/h",
    ],
    "--json": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
      "--json",
    ],
    "--words": [
      "--card",
      "hand:voice-mark-step",
      "--words",
      "what is a voice mark",
      "--anchor",
      "call:c#s-1",
      "--decided",
      "2026-09-25T15:40:00.000Z",
    ],
  },
  // `--call` and `--entries-file` are both required, so every fragment carries them; the console-origin group is all or none.
  "talk transcript": {
    "--console-default-port": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    // `--console-instance` qualifies a whole console-origin group, and is exactly `e2e`.
    "--console-instance": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN, "--console-instance", "e2e"],
    "--console-port": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    "--console-root": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    // The route's handoff intent beside the call (`site/lib/writerIntent.ts`).
    "--handoff": [...TRANSCRIPT_BASE, "--handoff", "/h/talk/calls/c.jsonl.intent.handoff.42.1"],
    "--dir": [
      "--call",
      "a0000041-0000-4000-8000-000000000044",
      "--entries-file",
      "/tmp/b.jsonl",
      "--dir",
      "/tmp/board",
    ],
    "--call": ["--call", "a0000041-0000-4000-8000-000000000044", "--entries-file", "/tmp/batch.jsonl"],
    "--entries-file": ["--call", "a0000041-0000-4000-8000-000000000044", "--entries-file", "/tmp/batch.jsonl"],
    "--home": ["--call", "a0000041-0000-4000-8000-000000000044", "--entries-file", "/tmp/b.jsonl", "--home", "/tmp/h"],
    "--json": ["--call", "a0000041-0000-4000-8000-000000000044", "--entries-file", "/tmp/batch.jsonl", "--json"],
  },
  "talk relay": {
    "--about": [...TALK_RELAY_BASE, "--about", "ask:acme-ask-6-sep-turn-95-1-give"],
    "--also-answers": [...TALK_RELAY_BASE, "--about", "ask:queue-freshness", "--also-answers", "ask:split-files"],
    "--candidate": [...TALK_RELAY_BASE, "--candidate", "c-105", "--reaction", "no"],
    "--console-default-port": [...TALK_RELAY_BASE, ...CONSOLE_ORIGIN],
    "--console-port": [...TALK_RELAY_BASE, ...CONSOLE_ORIGIN],
    "--console-root": [...TALK_RELAY_BASE, ...CONSOLE_ORIGIN],
    "--covers": [...TALK_RELAY_BASE, "--about", "act:ev-2", "--covers", "rule"],
    "--deliver-to-supervisor": [...TALK_RELAY_BASE, "--deliver-to-supervisor"],
    "--dir": [...TALK_RELAY_BASE, "--dir", "/tmp/handovers"],
    "--discuss-first": [...TALK_RELAY_BASE, "--discuss-first", "put", "--team-fix", "acme/acme-admin"],
    "--discuss-first-turn": [
      ...TALK_RELAY_BASE,
      "--discuss-first",
      "override",
      "--team-fix",
      "acme/acme-admin",
      "--discuss-first-turn",
      "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    ],
    "--fix-thread": [
      ...TALK_RELAY_BASE,
      "--discuss-first",
      "put",
      "--team-fix",
      "acme/acme-admin",
      "--fix-thread",
      "https://acme.slack.com/archives/C0SYN000001/p1791351441819519",
    ],
    "--team-fix": [...TALK_RELAY_BASE, "--discuss-first", "put", "--team-fix", "acme/acme-admin"],
    "--heard": [...TALK_RELAY_BASE, "--heard", "lets go with the smaller one"],
    "--heard-stdin": [...TALK_RELAY_BASE, "--heard-stdin"],
    "--heard-tail": [...TALK_RELAY_BASE, "--heard-tail", "cut"],
    "--home": [...TALK_RELAY_BASE, "--home", "/tmp/a-home"],
    "--json": [...TALK_RELAY_BASE, "--json"],
    "--feedback": [
      ...TALK_RELAY_BASE,
      "--about",
      "post:sd-1a2b3c4d",
      "--triage",
      "rewrite",
      "--feedback",
      "no-receipts",
    ],
    "--label": [...TALK_RELAY_BASE, "--about", "act:ev-9", "--triage", "send-it", "--label", "action-now"],
    "--offered-file": [...TALK_RELAY_BASE, "--offered-file", "/tmp/offer.json"],
    "--priority": [...TALK_RELAY_BASE, "--priority", "p1"],
    "--reaction": [...TALK_RELAY_BASE, "--candidate", "c-105", "--reaction", "no"],
    "--read-after": [
      "--turn",
      "a0000088-0000-4000-8000-000000000095",
      "--heard",
      "the queue row shows a raw id",
      "--read-after",
      "read_screen",
    ],
    "--say": TALK_RELAY_BASE,
    "--screen": [...TALK_RELAY_BASE, "--screen", "/tmp/screen.webp"],
    "--screen-failed": [...TALK_RELAY_BASE, "--screen-failed"],
    "--screen-not-taken": [...TALK_RELAY_BASE, "--screen-not-taken"],
    "--screen-recording-off": [...TALK_RELAY_BASE, "--screen-recording-off"],
    "--triage": [...TALK_RELAY_BASE, "--about", "act:ev-9", "--triage", "rewrite"],
    "--turn": TALK_RELAY_BASE,
    "--typed": ["--turn", "a0000088-0000-4000-8000-000000000095", "--typed", "--heard=the queue row shows a raw id"],
    "--words-alone": [
      "--turn",
      "a0000088-0000-4000-8000-000000000095",
      "--heard",
      "the queue row shows a raw id",
      "--words-alone",
    ],
    "--workspace": [...TALK_RELAY_BASE, "--workspace", "team", "--workspace-because", "said on the console"],
    "--workspace-because": [...TALK_RELAY_BASE, "--workspace", "self", "--workspace-because", "said there"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "talk transcript": ({ fragment }) => parseTranscriptArgs({ rest: fragment }),
  "talk land": ({ fragment }) => parseLandArgs({ rest: fragment }),
  "talk relay": ({ fragment }) => parseRelayArgs({ rest: fragment }),
};

/** The rows for `talk`'s card-landing, relay and transcript verbs. */
export const talkCardsAndRelaySlice: HelpTruthSlice = { guarded, probes, parsers };
