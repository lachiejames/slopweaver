/**
 * Lazy manifest for the `protect` noun — the owner's protected-path registry, `$SLOPWEAVER_HOME/protected-paths.json`.
 * `add` and `remove` are its only writers; `list` and `check` read it. The paths live in the state home and never in
 * the repository: this noun is the mechanism, and the `PreToolUse` guard is what refuses a protected path.
 */
import {
  PROTECT_ADD_USAGE,
  PROTECT_CHECK_USAGE,
  PROTECT_LIST_USAGE,
  PROTECT_REMOVE_USAGE,
} from "../commands/protect/protectUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const load = () => import("../commands/protect/run.js").then((m) => m.protectCommand);

const protectAddMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: 'slopweaver protect add ~/private --mode no-access --why "not for any session"',
  parseRejectIsIoFree: true,
  summary: "Protect a path from every session: read-only (never written) or no-access (never read or written)",
  usage: PROTECT_ADD_USAGE,
} as const;

const protectRemoveMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "SLOPWEAVER_ALLOW_PROTECT_REMOVE=1 slopweaver protect remove ~/private",
  parseRejectIsIoFree: true,
  summary: "Unprotect a path — refused unless the protect-remove hatch carries the owner's own word",
  usage: PROTECT_REMOVE_USAGE,
} as const;

const protectListMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver protect list",
  parseRejectIsIoFree: true,
  summary: "List every protected path, its mode and the owner's reason — and report a registry that will not parse",
  usage: PROTECT_LIST_USAGE,
} as const;

const protectCheckMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver protect check ~/private/notes.txt --write",
  parseRejectIsIoFree: true,
  summary: "Say whether one read or write of one path is refused, and by which protected path",
  usage: PROTECT_CHECK_USAGE,
} as const;

export const protectManifest: Readonly<Record<string, VerbManifestEntry>> = {
  add: lazy({ load, meta: protectAddMeta }),
  check: lazy({ load, meta: protectCheckMeta }),
  list: lazy({ load, meta: protectListMeta }),
  remove: lazy({ load, meta: protectRemoveMeta }),
};
