/**
 * The register read behind an omitted `cmux spawn --driver` — the effectful half of `../../../cmux/driverDefault.ts`.
 *
 * Read ONLY when the flag is absent: an explicit `--driver claude|codex` is the caller's own choice and must not
 * fail because the register could not be read. When the read is needed and fails, the spawn REFUSES rather than
 * guessing a host — a guess of Claude is exactly the unregistered credential a Codex-only install must not spend —
 * and the refusal names `--driver` as the way to say which host was meant.
 */

import { defaultCmuxDriver } from "../../../cmux/driverDefault.js";
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { stringFlag } from "./core.js";

/**
 * The host an omitted `--driver` boots on, read off this spawn's plan register.
 *
 * @param home the `--home` flag's value, or undefined for the ambient state home
 * @param parsed the verb's parsed flags
 * @param port where the plan register is read — the spawn's own port
 * @returns the default host (`claude` unread when `--driver` was passed, since the flag wins), or the exit code to
 *   stop on when the register could not be read
 */
export async function spawnDefaultDriver({
  home,
  parsed,
  port,
}: {
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
}): Promise<CmuxDriver | number> {
  if (stringFlag({ name: "driver", parsed }) !== undefined) {
    const unread: CmuxDriver = "claude";
    return unread;
  }
  let stateHome = slopweaverHome();
  if (home !== undefined) {
    stateHome = home;
  }
  const register = await port.read({ home: stateHome });
  if (register.isErr()) {
    logger.error({
      msg:
        `cmux spawn: refusing — no --driver was passed and the plan register could not be read to choose one ` +
        `(${register.error.message}); pass --driver claude or --driver codex`,
    });
    return EXIT_ERROR;
  }
  const driver = defaultCmuxDriver({ register: register.value });
  if (driver === "codex") {
    logger.info({ msg: "cmux spawn: no --driver, and the plan register holds only Codex plans — booting on codex" });
  }
  return driver;
}
