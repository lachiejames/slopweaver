/**
 * `slopweaver hand surface` — a seat's honest mid-investigation report, routed by the owner's urgency criterion.
 *
 * Prints the report, then the `handover register --finding` line the seat runs itself (a Queue card that does not
 * pause the investigation), and on a note route the checked `hand post` line the seat sends the pinned supervisor.
 * Runs nothing: the criterion and every posting rule live in `../../../hand/midState.ts`. The procedure is `skills/hand/reference/mid-investigation.md`.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { buildMidStateSurface } from "../../../hand/midState.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandSurfaceArgs } from "./surfaceArgs.js";
import { HAND_SURFACE_USAGE } from "./surfaceUsage.js";

/** Where the verb's lines go, injectable so a test reads them with plain arrays. */
export interface HandSurfaceIo {
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

/**
 * Run `hand surface` over an argv tail.
 *
 * @param rest the argv after `hand surface`
 * @param io where lines go
 * @returns 0 printed, 2 a malformed invocation or report
 */
export function runHandSurface({ rest, io }: { rest: readonly string[]; io: HandSurfaceIo }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    io.out(HAND_SURFACE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandSurfaceArgs({ rest });
  if (parsed.isErr()) {
    [parsed.error.message, HAND_SURFACE_USAGE].forEach((line) => {
      io.error(line);
    });
    return EXIT_USAGE;
  }
  const surface = buildMidStateSurface({ report: parsed.value.report });
  if (surface.isErr()) {
    io.error(`hand surface: ${surface.error.message}`);
    return EXIT_USAGE;
  }
  const { route, report, queue, note } = surface.value;
  if (parsed.value.json) {
    io.out(safeJsonStringify({ label: "hand surface", value: surface.value }));
    return EXIT_OK;
  }
  io.out(report);
  io.out("");
  io.out(`route: ${route.kind}`);
  io.out(`queue (run it yourself): ${queue.line}`);
  if (note !== undefined) {
    io.out(`note (send the pinned supervisor this one line): ${note.line}`);
  }
  return EXIT_OK;
}

/** `slopweaver hand surface` — the tail starts at index 4, after `hand surface`. */
export const handSurfaceCommand = defineCommand({
  run: (argv) =>
    runHandSurface({
      io: {
        error: (line) => {
          logger.error({ msg: line });
        },
        out: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(4),
    }),
});
