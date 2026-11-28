/**
 * The escape-hatch rows for SEATING a Claude session and the accounts it runs on — `cmux spawn`'s plan,
 * burst and backoff rails, and `claude rotate|signin|mint|reset`.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new spawn or Claude-account refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on spawning a Claude session and managing its accounts, in register order. */
export const CLAUDE_SESSION_HATCHES = [
  {
    caught: "the plan this session would spawn on is spent, and a spawn onto a spent plan burns an account",
    command: "slopweaver cmux spawn",
    exceptions: ["the spawn is onto a different account whose plan the store has not yet seen refresh"],
    id: "spent-plan",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_SPENT_PLAN" },
    lane: "ambient",
    reader: "src/claude/spawnStoreRefusals.ts",
    standing: "ruled",
  },
  {
    caught:
      "the plans register read fine, but no plan's gauge could be read even after repair — so how much of each is left is UNKNOWN rather than spent; an unreadable register is never this hatch's, and no override crosses it",
    command: "slopweaver cmux spawn",
    exceptions: [
      "the credential was verified usable while the gauge endpoint itself was the thing failing",
      "a session must open during a provider outage and booting on a named store with no usage limit set beats not booting",
    ],
    id: "unreadable-plan",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREADABLE_PLAN" },
    lane: "ambient",
    reader: "src/claude/spawnStoreRefusals.ts",
    standing: "proposed",
  },
  {
    caught:
      "enough Claude sessions booted in the last few minutes that the 1-minute load cannot see them yet, so one more is a burst no reading has judged — six boots in one pass reached load 45.9 before the next reading",
    command: "slopweaver cmux spawn",
    exceptions: [
      "the sessions counted are idle ones the owner opened and nothing in them is booting work",
      "a live bot tag or an owner-asked seat must open now, and waiting out the boot window would cost the thread",
      "re-running with --wait, which holds the spawn until the window clears, is the better answer and was not possible here",
    ],
    id: "boot-burst",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BOOT_BURST" },
    lane: "ambient",
    reader: "src/cli/commands/cmux/spawnCapacityWait.ts",
    standing: "proposed",
  },
  {
    caught:
      "the machine is past a capacity hold (load with no idle CPU, memory compression, swap, a stalled hook or a boot burst), so the fleet-wide spawn backoff has closed the door for an exponential window, or is admitting one spawn at a time while it recovers",
    command: "slopweaver cmux spawn",
    exceptions: [
      "the seat being opened is the one sent to investigate or relieve the hold itself",
      "a live bot tag or an owner-asked seat must open now, and waiting out the window would cost the thread",
      "the reading is plainly wrong about this machine — a gauge misread, not a loaded box — and the fix to the gauge is in flight",
    ],
    id: "spawn-backoff",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_SPAWN_BACKOFF" },
    lane: "ambient",
    reader: "src/cli/commands/cmux/spawnCapacityWait.ts",
    standing: "proposed",
  },
  {
    caught:
      "the worktree this row's spawn would reuse is held by ANOTHER row's unclosed run or parked seat, and a second session there shares that seat's working tree and index",
    command: "slopweaver cmux spawn",
    exceptions: [
      "the holding row's journal names a tree its seat has verifiably left, and the run cannot be closed or released first",
      "the named holder is an attribution the journal got wrong, checked against the live workspace standing in that tree",
    ],
    id: "foreign-worktree-holder",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FOREIGN_WORKTREE_HOLDER" },
    lane: "ambient",
    reader: "src/cli/commands/cmux/spawnTreeGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "copying a store's credential into the shared default keychain slot is retired: two slots holding one credential is revoked the moment either refreshes",
    command: "slopweaver claude rotate --commit",
    exceptions: ["a session needs a different account, which the store override gives it without copying anything"],
    id: "rotation-copy-retired",
    key: { incantation: "CLAUDE_SECURESTORAGE_CONFIG_DIR=<that plan's store> claude", kind: "command" },
    lane: "ambient",
    reader: "src/cli/commands/claude/rotate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the account now in this store is not the one enrolled for it, and an ordinary sign-in or enrollment may never overwrite a standing enrollment",
    command: "slopweaver claude signin",
    exceptions: [
      "the owner signed this account into this store deliberately, on the mapping the owner was given",
      "the standing enrollment was made from the wrong account and this corrects it",
    ],
    id: "identity-reenroll",
    key: { kind: "command", incantation: "slopweaver claude signin --reenroll <alias,...>" },
    lane: "ambient",
    reader: "src/cli/commands/claude/signinRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the authorize URL the setup-token login handed its browser is not on claude.com, and the mint will not pre-fill a plan's address onto a host nobody has vetted",
    command: "slopweaver claude mint",
    exceptions: ["Anthropic moved the authorize host and a fresh capture shows the new one", "a staging CLI build"],
    id: "claude-mint-authorize-host",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CLAUDE_MINT_AUTHORIZE_HOST" },
    lane: "ambient",
    reader: "src/cli/commands/claude/mintRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "no window on the plan is at its limit, and a free usage-limit reset refills only what is used — spent now it buys " +
      "little and is gone for the wall it was held for",
    command: "slopweaver claude reset --claim",
    exceptions: [
      "the grant ends before the plan could plausibly reach a limit, so holding it loses it anyway",
      "the status read is stale: a seat on this plan just hit the usage-limit wall the read has not caught up with",
    ],
    id: "early-claude-reset",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_EARLY_CLAUDE_RESET" },
    lane: "ambient",
    reader: "src/cli/commands/claude/resetRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
