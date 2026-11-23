/**
 * Lazy manifest for the `chatgpt` noun — the owner's ChatGPT history in two shapes:
 *
 * - `import-export` and `sync` take the official export the owner downloads into the corpus as the `chatgpt` source.
 *   Neither verb reaches the network or a browser.
 * - `import-request` keeps the owner's pasted web session; `list` lists every conversation on the account through
 *   it, `conversation` reads one named chat whole into a transcript, and `live-sync` holds every chat whole and
 *   refreshes them into the corpus. That web backend is private and undocumented, so each reads it through strict
 *   boundaries and prints its caveats.
 *
 * `list` writes nothing; every other verb writes `local-state` only: `import-request` the 0600 session file,
 * `conversation` the transcript under `live/`, `live-sync` the live copy and the corpus, `import-export` the held
 * export, `sync` that and the corpus. The egresses are `list`'s, `conversation`'s and `live-sync`'s read-only GETs
 * to the account the session came from, so none is door-routed.
 */
import {
  CHATGPT_CONVERSATION_USAGE,
  CHATGPT_IMPORT_EXPORT_USAGE,
  CHATGPT_IMPORT_REQUEST_USAGE,
  CHATGPT_LIST_USAGE,
  CHATGPT_LIVE_SYNC_USAGE,
  CHATGPT_SYNC_USAGE,
} from "../commands/chatgpt/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `chatgpt` noun's verbs as lazy manifest entries. */
export const chatgptManifest: Readonly<Record<string, VerbManifestEntry>> = {
  conversation: lazy({
    load: () => import("../commands/chatgpt/run.js").then((m) => m.chatgptConversationCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver chatgpt conversation 6aba18a1-5280-83ec-9115-b16ac7e6a181",
      parseRejectIsIoFree: true,
      summary: "Read one ChatGPT conversation whole, by id, into a local transcript",
      usage: CHATGPT_CONVERSATION_USAGE,
    },
  }),
  "import-export": lazy({
    load: () => import("../commands/chatgpt/exportRun.js").then((m) => m.chatgptImportExportCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver chatgpt import-export --from ~/Downloads/chatgpt-export.zip",
      parseRejectIsIoFree: true,
      summary: "Take one official ChatGPT export in, at 0600, ready for `chatgpt sync`",
      usage: CHATGPT_IMPORT_EXPORT_USAGE,
    },
  }),
  "import-request": lazy({
    load: () => import("../commands/chatgpt/run.js").then((m) => m.chatgptImportRequestCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver chatgpt import-request --from ~/request.txt",
      parseRejectIsIoFree: true,
      summary: "Keep a pasted chatgpt.com request's session headers at 0600 and remove the paste",
      usage: CHATGPT_IMPORT_REQUEST_USAGE,
    },
  }),
  "live-sync": lazy({
    load: () => import("../commands/chatgpt/liveSyncRun.js").then((m) => m.chatgptLiveSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver chatgpt live-sync",
      parseRejectIsIoFree: true,
      summary:
        "Hold every chat on the owner's ChatGPT account whole, newest first and paced, then refresh them into the corpus",
      usage: CHATGPT_LIVE_SYNC_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/chatgpt/listRun.js").then((m) => m.chatgptListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver chatgpt list",
      parseRejectIsIoFree: true,
      summary:
        "List every conversation on the owner's ChatGPT account — main, archived and Projects — paced, writing nothing",
      usage: CHATGPT_LIST_USAGE,
    },
  }),
  sync: lazy({
    load: () => import("../commands/chatgpt/exportRun.js").then((m) => m.chatgptSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver chatgpt sync",
      parseRejectIsIoFree: true,
      summary: "Bring the owner's ChatGPT history into the corpus and the store from every export they downloaded",
      usage: CHATGPT_SYNC_USAGE,
    },
  }),
};
