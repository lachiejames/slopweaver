/**
 * The recheck `./tickCloseCommit.ts` runs past the chair gate and before EVERY stage: everything the prepare half
 * validated — the home, the tick directory, a resumed close's committed form, the staged list it bound and the tick
 * file — must still be what it validated, or the close stops instead of committing what replaced it.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { sha256Hex } from "../../../supervisor/tickPlan.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import type { PreparedClose } from "./tickClosePrepare.js";
import { boundListBytes } from "./tickCloseRefresh.js";
import { homeOutsideSeat, readStrictText, TICK_INPUT_FILE, tickDirIntact } from "./tickFiles.js";

/**
 * On a close resumed past `form-committed`, the seat's `form.json` must still be the form the page was rendered
 * from. That close publishes a page for the form it READ, never one it wrote, so a form replaced after the read
 * would publish a page the seat no longer holds.
 *
 * @returns nothing, or the refusal naming the replaced form
 */
function committedFormUnchanged({ prepared }: { prepared: PreparedClose }): Result<void, TickWorkflowError> {
  if (prepared.owed.includes("form-committed")) {
    return ok(undefined);
  }
  const path = join(prepared.dir, "form.json");
  const text = readStrictText({ path });
  if (text.isErr()) {
    return err(TickWorkflowErrors.preflightRefused({ reasons: [text.error], stage: "the committed form" }));
  }
  if (text.value.text === prepared.formAfter) {
    return ok(undefined);
  }
  return err(
    TickWorkflowErrors.preflightRefused({
      reasons: [`${path} changed after this resumed close rendered its page — close again to render what is there now`],
      stage: "the committed form",
    }),
  );
}

/**
 * The staged list the close bound must still hold the bytes with its digest; a close on the seat's own list bound
 * none, so there is nothing to compare.
 *
 * @returns nothing, or the refusal naming the replaced list
 */
function boundListUnchanged({ prepared }: { prepared: PreparedClose }): Result<void, TickWorkflowError> {
  if (prepared.listSha256 === null) {
    return ok(undefined);
  }
  return boundListBytes({ listSha256: prepared.listSha256, path: join(prepared.tickDir, "run.json") })
    .map(() => undefined)
    .mapErr((reason) => TickWorkflowErrors.preflightRefused({ reasons: [reason], stage: "the staged list" }));
}

/**
 * Whether the tick file on disk is still the one the prepare half validated: the SAME file, by device and inode,
 * holding the same bytes, both read through one descriptor. The hash alone loses to a helper that swaps a clone
 * of the directory, holding a copy of the validated text, in for the edited original just while this read runs;
 * the clone's copy is a different inode.
 *
 * @returns nothing, or the refusal naming what changed
 */
function tickFileUnchanged({ prepared }: { prepared: PreparedClose }): Result<void, TickWorkflowError> {
  const path = join(prepared.tickDir, TICK_INPUT_FILE);
  const text = readStrictText({ path });
  if (text.isErr()) {
    return err(TickWorkflowErrors.preflightRefused({ reasons: [text.error], stage: "the tick file" }));
  }
  if (text.value.identity !== prepared.inputIdentity) {
    return err(
      TickWorkflowErrors.preflightRefused({
        reasons: [`${path} is no longer the file that was validated — close again to validate what is there now`],
        stage: "the tick file",
      }),
    );
  }
  const now = sha256Hex({ text: text.value.text });
  if (now === prepared.inputSha256) {
    return ok(undefined);
  }
  return err(
    TickWorkflowErrors.preflightRefused({
      reasons: [
        `${path} changed after it was validated (sha256 ${prepared.inputSha256.slice(0, 12)}, now ` +
          `${now.slice(0, 12)}) — close again to validate the edit`,
      ],
      stage: "the tick file",
    }),
  );
}

/**
 * Whether everything the prepare half validated is still what it validated, checked in a fixed order: the home,
 * the tick directory, a resumed close's committed form, the bound staged list, then the tick file.
 *
 * @param prepared everything the prepare half decided
 * @returns nothing, or the first refusal naming what changed
 */
export function preparedUnchanged({ prepared }: { prepared: PreparedClose }): Result<void, TickWorkflowError> {
  return homeOutsideSeat({ dir: prepared.dir, home: prepared.home })
    .andThen(() => tickDirIntact({ identity: prepared.tickDirIdentity, tickDir: prepared.tickDir }))
    .andThen(() => committedFormUnchanged({ prepared }))
    .andThen(() => boundListUnchanged({ prepared }))
    .andThen(() => tickFileUnchanged({ prepared }));
}
