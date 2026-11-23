/**
 * The `talk` verbs that move the supervisor's unread cursor over the owner's console-voice words — `unread`, which
 * prints them and with `--mark` records them read, `unread-adopt`, which marks a backlog another reader already read,
 * `quarantine`, which accepts a gone call's loss so a read passes it, and `cursor-retire`, which sets aside a cursor
 * that no longer reads. Every usage here is quoted from `commands/talk/usage.ts`, and `talk.ts` spreads this map into
 * the noun's manifest.
 */
import {
  TALK_CURSOR_RETIRE_USAGE,
  TALK_QUARANTINE_USAGE,
  TALK_UNREAD_ADOPT_USAGE,
  TALK_UNREAD_USAGE,
} from "../commands/talk/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkQuarantineMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver talk quarantine 8d74b96f-f72d-4135-be24-b78897fa3926 --reason "removed by hand"',
  parseRejectIsIoFree: true,
  summary: "Accept one gone console-voice call's loss on the record, so talk unread reads past it",
  usage: TALK_QUARANTINE_USAGE,
} as const;

const talkCursorRetireMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk cursor-retire --json",
  parseRejectIsIoFree: true,
  summary:
    "Retire a talk unread cursor whose call files were rewritten or that will not parse — a preview by default; --apply moves it, unchanged, beside a receipt so the next read starts fresh",
  usage: TALK_CURSOR_RETIRE_USAGE,
} as const;

const talkUnreadMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk unread",
  parseRejectIsIoFree: true,
  summary:
    "Every word the owner spoke on a console-voice call that the supervisor has not read, relayed or not — and with --mark, the record that it has",
  usage: TALK_UNREAD_USAGE,
} as const;

const talkUnreadAdoptMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver talk unread-adopt --before 2026-11-17T06:00:00.000Z --why "read on another machine"',
  parseRejectIsIoFree: true,
  summary:
    "Mark every voice stretch stamped before an instant read for one cursor without printing them — a backlog another reader already read — previewed with a digest, applied only with it, and left a receipt",
  usage: TALK_UNREAD_ADOPT_USAGE,
} as const;

const loadQuarantine = () => import("../commands/talk/quarantineRun.js").then((m) => m.talkQuarantineCommand);
const loadCursorRetire = () => import("../commands/talk/cursorRetireRun.js").then((m) => m.talkCursorRetireCommand);
const loadUnread = () => import("../commands/talk/unreadRun.js").then((m) => m.talkUnreadCommand);
const loadUnreadAdopt = () => import("../commands/talk/unreadAdoptRun.js").then((m) => m.talkUnreadAdoptCommand);

export const talkUnreadManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "cursor-retire": lazy({ load: loadCursorRetire, meta: talkCursorRetireMeta }),
  quarantine: lazy({ load: loadQuarantine, meta: talkQuarantineMeta }),
  unread: lazy({ load: loadUnread, meta: talkUnreadMeta }),
  "unread-adopt": lazy({ load: loadUnreadAdopt, meta: talkUnreadAdoptMeta }),
};
