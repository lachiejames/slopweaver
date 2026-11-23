/**
 * The `responders` noun — `responders.json`, the SAME list gating who may address the bot and who may receive
 * a real reply: `list` reads it, and `add`/`remove` are its one real, deliberate write path.
 *
 * `list` writes nothing (`none`): it reads that one JSON array and the Slack member rows. `add`/`remove` are
 * `local-state`, atomically rewriting it. None touches anything outside the machine — never a door-routed write.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const respondersManifest: Readonly<Record<string, VerbManifestEntry>> = {
  add: lazy({
    load: () => import("../commands/responders/run.js").then((m) => m.respondersAddCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver responders add --user U0123456 --reason "owner asked live in Slack"',
      parseRejectIsIoFree: true,
      summary: "Add one Slack user id to responders.json — required --reason, printed back",
      usage: "usage: slopweaver responders add --user <id> --reason <text> [--home <dir>]",
    } as const,
  }),
  list: lazy({
    load: () => import("../commands/responders/list.js").then((m) => m.respondersListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver responders list",
      parseRejectIsIoFree: true,
      summary: "List who may address the bot — each Slack user id on responders.json with its name; read-only",
      usage: "usage: slopweaver responders list [--json] [--home <dir>]",
    } as const,
  }),
  remove: lazy({
    load: () => import("../commands/responders/run.js").then((m) => m.respondersRemoveCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver responders remove --user U0123456 --reason "no longer needed"',
      parseRejectIsIoFree: true,
      summary: "Remove one Slack user id from responders.json — required --reason, printed back",
      usage: "usage: slopweaver responders remove --user <id> --reason <text> [--home <dir>]",
    } as const,
  }),
};
