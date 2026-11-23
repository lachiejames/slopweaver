/**
 * The escape-hatch row for `slopweaver listen`'s Socket Mode connection — a second connection beside one
 * already open.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly before
 * the Codex pass rows. Add a row for a new listener-connection refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the listener's Socket Mode connection, in register order. */
export const LISTEN_CONNECTION_HATCHES = [
  {
    caught: "a second Socket Mode connection steals events from the first, so two listeners answer nothing reliably",
    command: "slopweaver listen",
    exceptions: ["the earlier connection is known dead and its process has already exited"],
    id: "multiple-socket-connections",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS" },
    lane: "ambient",
    reader: "src/live/listen/connections.ts",
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
