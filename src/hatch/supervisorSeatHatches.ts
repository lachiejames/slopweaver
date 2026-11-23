/**
 * The escape-hatch rows for WHERE the supervisor sits and what it seats — a chair off its model or on a
 * metered plan, a seat with no route, and a takeover over owner turns nobody has read.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new chair, seat or takeover refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the supervisor's chair, seating and takeover, in register order. */
export const SUPERVISOR_SEAT_HATCHES = [
  {
    caught:
      "the pinned supervisor workspace holds a Claude session that is not running on its required model — Fable while more than one Claude plan stands, Opus once exactly one does — its newest assistant turn ran on another model, or a safeguard fallback switched the session and nothing has run on the required model since — a chair on another model must be essentially impossible",
    command: "slopweaver supervisor tick-record|sweep-prompt",
    exceptions: [
      "Fable is exhausted on every plan and the owner has asked for an interim chair on another model until it resets",
      "the chair read itself is what is broken — cmux answered the walk with an error or with no chair it could resolve, or the caller's own transcript cannot be read either, or the supervisor-pin record does not name the caller (a silent cmux — a timeout or no socket — alone no longer refuses: the gate judges the calling session's transcript itself when the pin record names it) — and the seat has been confirmed on Fable another way, such as /model in that tab",
      "the chair has already typed /model fable at itself this tick and the owner wants this one tick recorded rather than waiting for the next one to read the restored seat",
    ],
    id: "off-fable-chair",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_OFF_FABLE_CHAIR" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/chairGateRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "a Claude session in the pinned supervisor workspace is spending a metered, per-token Console organisation: its newest claude_code.api_request telemetry resolves no claude.ai organisation (measured: a chair spent $7.38 that way while ON FABLE, so the Fable check could not see it)",
    command: "slopweaver supervisor tick-record|sweep-prompt",
    exceptions: [
      "every plan is exhausted and the owner has asked for an interim chair on a Console organisation until one resets",
      "the telemetry is wrong about this seat: it has been confirmed on a plan login another way, such as /status in that tab naming a Max plan",
      "the chair has already been re-seated on a plan this tick and the verdict is still reading the old login's final prompts",
    ],
    id: "metered-chair",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_METERED_CHAIR" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/chairGateRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "this Claude session was not booted on any configured plan — it is on the default /login, a store no plan names, or an API key that bills a Console organisation per token — so its turn is refused before a request is spent — a session on the wrong billing account or in the wrong state fails to start or fails the turn",
    command: "slopweaver claude seat",
    exceptions: [
      "the owner signed the default store in on purpose for a one-off — a `claude reset` sign-in test, say — and wants this one session on it",
      "every plan is exhausted and the owner has asked for an interim session on a Console organisation until one resets",
      "the reading is wrong about this session: it has been confirmed on a plan another way, such as /status in that tab naming a Max plan",
    ],
    id: "unrouted-seat",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNROUTED_SEAT" },
    lane: "ambient",
    reader: "src/cli/commands/claude/seatRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "this chair has not read every owner turn of the last seven days, so it is about to take the pin without knowing what the owner has asked for — a chair that reads the last week of owner turns knows what is expected of it",
    command: "slopweaver cmux takeover",
    exceptions: [
      "the predecessor is dead or wedged and the fleet has no chair at all, so taking the pin first and reading immediately after is the lesser harm",
      "the turn reader itself cannot reach the transcripts, and the chair has read the owner's turns another way",
    ],
    id: "unread-owner-turns",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREAD_OWNER_TURNS" },
    lane: "ambient",
    reader: "src/cli/commands/cmux/takeover.ts",
    standing: "proposed",
  },
  {
    caught:
      "a worker seat would run on Fable, the model the supervisor chair sits on, and every unpinned spawn inheriting it is what puts the whole fleet on Fable (Fable is roughly one spawn in twenty, for a deep investigation)",
    command: "slopweaver cmux spawn <slug> --model fable",
    exceptions: [
      "one of those few instances where fable is the right tool for the job — a deep investigation such as a Datadog dig or a connection-pool exhaustion",
      "a worker reseat that TYPES `--model fable` for a seat already doing one of those investigations (a reseat that keeps the ledger's model is never refused)",
    ],
    id: "fable-worker",
    key: { kind: "env", variable: "ALLOW_FABLE_OVERRIDE" },
    lane: "ambient",
    reader: "src/cmux/modelPin.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
