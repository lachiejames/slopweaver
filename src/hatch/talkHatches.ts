/**
 * The escape-hatch rows owned by `slopweaver talk` verbs: the console voice's LOCAL FILE surface — `talk file`,
 * which reads any file on this machine for the voice and refuses one class, a
 * credential — `talk unread`'s first mark, a console that is not the owner's writing their live talk store, and the one row
 * not read by a `talk` verb: the `PreToolUse` tripwire refusing a hand-run command that would remove the talk
 * store's call state (`../admit/callStateGuard.ts`), kept here because it guards the same files.
 *
 * A sibling of `./registry.ts` for the reason `./codexPassHatches.ts` gives: the register sheds a whole surface
 * to its own file rather than grow past `file-size-ratchet`. `ESCAPE_HATCHES` spreads it back in, so there is
 * still exactly ONE register.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch a `talk` verb reads, and the call-state tripwire's. */
export const TALK_HATCHES = [
  {
    caught:
      "the path, or where it resolves to, is a credential store ($SLOPWEAVER_HOME/secrets, ~/.ssh, ~/.aws, a keychain…) " +
      "or is named like a credential file (.env, *.pem, id_ed25519), and what the console voice reads leaves this machine " +
      "to OpenAI — the masking of credentials inside an ordinary file is NOT lifted by this hatch",
    command: "slopweaver talk file read|list",
    exceptions: [
      "the owner asked, in their own words, for a non-secret file that sits inside a credential store — ~/.ssh/config, ~/.aws/config, a known_hosts",
      "a file whose name only looks like a credential's and holds none — an .env.local of feature flags the owner named",
    ],
    id: "talk-file-credential",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_TALK_FILE_CREDENTIAL" },
    lane: "ambient",
    reader: "src/cli/commands/talk/fileRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "a `talk unread` first mark would record as read what it never printed: stretches of the owner's speech a first read's " +
      "24-hour window left out",
    command: "slopweaver talk unread --mark",
    exceptions: [
      "those older calls were already read by hand, or ruled on in an earlier chair's own sweep",
      "the cursor was just removed to recover from a refused call file, and every word before the window was marked read before that",
    ],
    id: "unread-mark-adopt",
    key: { kind: "command", incantation: "slopweaver talk unread --mark --adopt" },
    lane: "ambient",
    reader: "src/cli/commands/talk/unreadRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "a console that is not the owner's — served from a checkout that is not the main worktree the owner's profile declares, or on a port other than the console's default — " +
      "would write speech into a live talk store, where `talk unread` hands it to the chair; a witness run starts its console " +
      "on its own SLOPWEAVER_HOME (the variable is read from the console server's environment, and never opens the owner's chat: " +
      "a relay or a wake from such a console is refused whatever is open)",
    command: "slopweaver talk transcript|relay",
    exceptions: [
      "the live-home path itself is what is being witnessed, against one disposable call that is then LEFT in place — a live home's call file is never removed (`call-state-delete`)",
      "the owner's own console has to run on a second port for a while and they asked for it — the call is still stamped not the owner's",
    ],
    id: "non-owner-console-live-talk",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_NON_OWNER_CONSOLE_LIVE_TALK" },
    lane: "ambient",
    reader: "src/cli/commands/talk/consoleOrigin.ts",
    standing: "proposed",
  },
  {
    caught:
      "it would delete, move or overwrite a live home's console-voice call state — a call file, the call index, a reader's " +
      "unread cursor or the quarantine ledger — and a call file is the owner's words: nothing in Slopweaver removes one, and a gone " +
      "one refuses every `talk unread` until its loss is quarantined (measured: a seat's hand `rm` of seven test calls)",
    command:
      "a Bash rm, unlink, rmdir, shred, srm, trash, mv, cp, install, ln, rsync, ditto, truncate, tee (not tee -a), " +
      "in-place sed/perl/ruby, find -delete or -exec of a remover, git clean, or truncating > redirect reaching talk call state",
    exceptions: [
      "the call state named is in a throwaway home the guard mistook for a live one — a test's own synthetic calls, never the owner's words — and you have checked the path",
      "a repair the owner asked for, in their own words, rewrites a live home's call index or an unread cursor — never a call file — and a copy is kept",
    ],
    id: "call-state-delete",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CALL_STATE_DELETE" },
    lane: "ambient",
    reader: "src/admit/callStateGuard.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
