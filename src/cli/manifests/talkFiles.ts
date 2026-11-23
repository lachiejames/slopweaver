/**
 * The `talk` noun's FILE verbs, spread into `./talk.ts` — `code`, the tracked files of this checkout, `file`, any
 * file on this machine (the console voice is as capable as any claude session),
 * and `attach`, which keeps a file the owner attached in the Messenger where `file` reads it. Their own module, like
 * `./githubCi.ts`, so the noun's manifest stays under the ratchet.
 */
import { TALK_ATTACH_USAGE, TALK_CODE_USAGE, TALK_FILE_USAGE } from "../commands/talk/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkCodeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk code find --text safeProviderCall --json",
  parseRejectIsIoFree: true,
  summary: "Read the TRACKED files of this checkout, bounded — find a literal, read a window, list a directory",
  usage: TALK_CODE_USAGE,
} as const;

const talkFileMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk file read --path ~/Downloads/notes.txt --json",
  parseRejectIsIoFree: true,
  summary:
    "Read any file or list any directory on this machine, bounded — a credential store refused, every credential masked, and a published page's address read out of the store",
  usage: TALK_FILE_USAGE,
} as const;

const talkAttachMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk attach --file /tmp/staged/notes.md --name notes.md --json",
  parseRejectIsIoFree: true,
  summary:
    "Keep a copy of a picture or text file the owner attached in the console's Messenger under the home, for the thinking model's file_read — refused whole when it is too large or not one the voice reads",
  usage: TALK_ATTACH_USAGE,
} as const;

const loadCode = () => import("../commands/talk/codeRun.js").then((m) => m.talkCodeCommand);
const loadFile = () => import("../commands/talk/fileRun.js").then((m) => m.talkFileCommand);
const loadAttach = () => import("../commands/talk/attachRun.js").then((m) => m.talkAttachCommand);

/** `talk code`, `talk file` and `talk attach`, spread into the noun's manifest. */
export const talkFilesManifest: Readonly<Record<string, VerbManifestEntry>> = {
  attach: lazy({ load: loadAttach, meta: talkAttachMeta }),
  code: lazy({ load: loadCode, meta: talkCodeMeta }),
  file: lazy({ load: loadFile, meta: talkFileMeta }),
};
