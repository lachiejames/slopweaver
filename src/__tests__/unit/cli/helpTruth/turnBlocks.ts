/**
 * The help-truth tables' rows for `turn`'s block, ledger and reaction verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseTurnBlockArgs } from "../../../../cli/commands/turn/block.js";
import { parseTurnBlockedArgs } from "../../../../cli/commands/turn/blockedList.js";
import { parseTurnBreakageArgs } from "../../../../cli/commands/turn/breakage.js";
import { TURN_BREAKAGE_FLAG_SPEC } from "../../../../cli/commands/turn/breakageUsage.js";
import {
  TURN_BLOCK_FLAG_SPEC,
  TURN_BLOCKED_FLAG_SPEC,
  TURN_IGNORE_CONVERSATION_FLAG_SPEC,
  TURN_IGNORE_FLAG_SPEC,
  TURN_REACH_FLAG_SPEC,
  TURN_SETTLE_REACTION_FLAG_SPEC,
  TURN_UNBLOCK_FLAG_SPEC,
} from "../../../../cli/commands/turn/core.js";
import { parseTurnIgnoreArgs } from "../../../../cli/commands/turn/ignore.js";
import { parseTurnIgnoreConversationArgs } from "../../../../cli/commands/turn/ignoreConversation.js";
import { parseTurnLedgerArgs } from "../../../../cli/commands/turn/ledger.js";
import { TURN_LEDGER_FLAG_SPEC } from "../../../../cli/commands/turn/ledgerUsage.js";
import { parseTurnReachArgs } from "../../../../cli/commands/turn/reach.js";
import { parseTurnRetireCardArgs } from "../../../../cli/commands/turn/retireCard.js";
import { TURN_RETIRE_CARD_FLAG_SPEC } from "../../../../cli/commands/turn/retireCardUsage.js";
import { parseTurnSatisfiedArgs } from "../../../../cli/commands/turn/satisfied.js";
import { TURN_SATISFIED_FLAG_SPEC } from "../../../../cli/commands/turn/satisfiedUsage.js";
import { parseTurnSettleReactionArgs } from "../../../../cli/commands/turn/settleReaction.js";
import { parseTurnUnblockArgs } from "../../../../cli/commands/turn/unblock.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** `turn ignore`'s advertised flags, derived from the spec the verb parses with. */
const TURN_IGNORE_FLAG_NAMES: readonly string[] = [
  ...TURN_IGNORE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_IGNORE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn ignore-conversation`'s advertised flags, derived from the spec the verb parses with. */
const TURN_IGNORE_CONVERSATION_FLAG_NAMES: readonly string[] = [
  ...TURN_IGNORE_CONVERSATION_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_IGNORE_CONVERSATION_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn block`'s advertised flags, derived from the spec the verb parses with. */
const TURN_BLOCK_FLAG_NAMES: readonly string[] = [
  ...TURN_BLOCK_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_BLOCK_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn blocked`'s advertised flags, derived from the spec the verb parses with. */
const TURN_BLOCKED_FLAG_NAMES: readonly string[] = [
  ...TURN_BLOCKED_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_BLOCKED_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn ledger`'s advertised flags, derived from the spec the verb parses with. */
const TURN_LEDGER_FLAG_NAMES: readonly string[] = [
  ...TURN_LEDGER_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_LEDGER_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn reach`'s advertised flags, derived from the spec the verb parses with. */
const TURN_REACH_FLAG_NAMES: readonly string[] = [
  ...TURN_REACH_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_REACH_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn unblock`'s advertised flags, derived from the spec the verb parses with. */
const TURN_UNBLOCK_FLAG_NAMES: readonly string[] = [
  ...TURN_UNBLOCK_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_UNBLOCK_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn breakage`'s advertised flags, derived from the spec the verb parses with. */
const TURN_BREAKAGE_FLAG_NAMES: readonly string[] = [
  ...TURN_BREAKAGE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_BREAKAGE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn retire-card`'s advertised flags, derived from the spec the verb parses with. */
const TURN_RETIRE_CARD_FLAG_NAMES: readonly string[] = [
  ...TURN_RETIRE_CARD_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_RETIRE_CARD_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn satisfied`'s advertised flags, derived from the spec the verb parses with. */
const TURN_SATISFIED_FLAG_NAMES: readonly string[] = [
  ...TURN_SATISFIED_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_SATISFIED_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn settle-reaction`'s advertised flags, derived from the spec the verb parses with. */
const TURN_SETTLE_REACTION_FLAG_NAMES: readonly string[] = [
  ...TURN_SETTLE_REACTION_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_SETTLE_REACTION_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "turn block": TURN_BLOCK_FLAG_NAMES,
  "turn blocked": TURN_BLOCKED_FLAG_NAMES,
  "turn breakage": TURN_BREAKAGE_FLAG_NAMES,
  "turn ignore": TURN_IGNORE_FLAG_NAMES,
  "turn ignore-conversation": TURN_IGNORE_CONVERSATION_FLAG_NAMES,
  "turn ledger": TURN_LEDGER_FLAG_NAMES,
  "turn reach": TURN_REACH_FLAG_NAMES,
  "turn retire-card": TURN_RETIRE_CARD_FLAG_NAMES,
  "turn satisfied": TURN_SATISFIED_FLAG_NAMES,
  "turn settle-reaction": TURN_SETTLE_REACTION_FLAG_NAMES,
  "turn unblock": TURN_UNBLOCK_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "turn ignore": {
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--reason": ["--reason", "not worth another turn"],
    "--remove": ["--remove"],
  },
  "turn ignore-conversation": {
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--list": ["--list"],
    "--reason": ["--reason", "not worth another turn"],
    "--remove": ["--remove"],
  },
  "turn block": {
    "--brief": ["--brief", "/tmp/brief.json"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--model": ["--model", "the supervisor session"],
    "--need": ["--need", "sign-in"],
    "--session-url": ["--session-url", "https://example.invalid/session"],
    "--sign-in-url": ["--need", "sign-in", "--sign-in-url", "https://admin.google.com/ac/users"],
    "--what": ["--what", "sign in to Google Cloud locally"],
  },
  "turn blocked": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "turn ledger": {
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "20"],
    "--since": ["--since", "2026-09-15T00:00:00Z"],
  },
  "turn reach": {
    "--brief": ["--brief", "/tmp/brief.json"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--model": ["--model", "the supervisor session"],
    "--session-url": ["--session-url", "https://example.invalid/session"],
    "--url": ["--url", "https://admin.google.com/ac/users"],
  },
  "turn unblock": {
    "--brief": ["--brief", "/tmp/brief.json"],
    "--channel": ["--channel", "C123"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--model": ["--model", "the supervisor session"],
    "--note": ["--note", "signed in"],
    "--session-url": ["--session-url", "https://example.invalid/session"],
  },
  "turn breakage": {
    "--cause": ["--cause", "the flag keeps only its last value"],
    "--classes": ["--classes"],
    "--did-instead": ["--did-instead", "answered the newest message first"],
    "--error": ["--error", "the thread moved"],
    "--home": ["--home", "/tmp"],
    "--thread": ["--thread", "C123/1712345678.000100"],
    "--what": ["--what", "turn answer"],
  },
  "turn retire-card": {
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--working-ts": ["--working-ts", "1712345680.000200"],
  },
  "turn satisfied": {
    "--answered-by-ts": ["--answered-by-ts", "1712345678.000200"],
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--reason": ["--reason", "answered above in this thread"],
  },
  "turn settle-reaction": {
    "--channel": ["--channel", "C123"],
    "--home": ["--home", "/tmp"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--to": ["--to", "completion"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "turn block": ({ fragment }) => parseTurnBlockArgs({ rest: [...fragment] }),
  "turn blocked": ({ fragment }) => parseTurnBlockedArgs({ rest: [...fragment] }),
  "turn breakage": ({ fragment }) => parseTurnBreakageArgs({ rest: [...fragment] }),
  "turn ledger": ({ fragment }) => parseTurnLedgerArgs({ rest: [...fragment] }),
  "turn reach": ({ fragment }) => parseTurnReachArgs({ rest: [...fragment] }),
  "turn ignore": ({ fragment }) => parseTurnIgnoreArgs({ rest: [...fragment] }),
  "turn ignore-conversation": ({ fragment }) => parseTurnIgnoreConversationArgs({ rest: [...fragment] }),
  "turn retire-card": ({ fragment }) => parseTurnRetireCardArgs({ rest: [...fragment] }),
  "turn satisfied": ({ fragment }) => parseTurnSatisfiedArgs({ rest: [...fragment] }),
  "turn settle-reaction": ({ fragment }) => parseTurnSettleReactionArgs({ rest: [...fragment] }),
  "turn unblock": ({ fragment }) => parseTurnUnblockArgs({ rest: [...fragment] }),
};

/** The rows for `turn`'s block, ledger and reaction verbs. */
export const turnBlocksSlice: HelpTruthSlice = { guarded, probes, parsers };
