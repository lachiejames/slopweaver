/**
 * `slopweaver hand post`'s flags read into the inputs a step is drafted from: the four required fields, the posting
 * form and tier it must state out loud, the note's address, and the picture `--shot` names.
 *
 * Its own module because this is the half of the verb that only READS argv: it judges how the flags combine and
 * nothing about the step itself, which `../../../hand/step.ts` judges once `./post.ts` has drafted it. Every
 * refusal here is a caller mistake, so each one ends the verb at `EXIT_USAGE` before anything is read from disk.
 */
import { checklistFlagValue } from "../../../hand/checklist.js";
import { consoleQueueLink, withQueueContext } from "../../../hand/consoleLink.js";
import { isLinkContext } from "../../../hand/consoleLinkNames.js";
import { parseRecheckFlag } from "../../../hand/recheck.js";
import type { HandShot } from "../../../hand/shot.js";
import type { HandStepDraft } from "../../../hand/step.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { POST_USAGE, parseHandPostArgs } from "./core.js";
import { bySession, flag, type HandDeps } from "./deps.js";
import { type HandPostArgsError, HandPostArgsErrors, handPostArgsLines } from "./postArgsErrors.js";
import { type ShotFlags, shotFlagsOf } from "./postPicture.js";

/** The four flags a step cannot be built without, or undefined when any is missing. */
function required({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { id: string; what: string; unblocks: string; witness: string } | undefined {
  const id = flag({ name: "id", values });
  const what = flag({ name: "what", values });
  const unblocks = flag({ name: "unblocks", values });
  const witness = flag({ name: "witness", values });
  if (id === undefined || what === undefined || unblocks === undefined || witness === undefined) {
    return undefined;
  }
  return { id, unblocks, what, witness };
}

/**
 * Which of the two posting forms the flags chose: a step that waits on a board row, or one no row owns.
 *
 * Exactly one, never inferred. `hand post` has no trustworthy signal that its caller is inside a run —
 * `--by-session` is free text and `--unblocks` is prose — so a rule that guessed would be wrong exactly when
 * it mattered. Saying `--standalone` out loud is the cost of a card that can never
 * leave on evidence.
 *
 * @param values every parsed flag
 * @returns the row slug, `undefined` for a standalone step, or the refusal naming both flags
 */
function postingForm({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): Result<string | undefined, HandPostArgsError> {
  const row = flag({ name: "row", values });
  const standalone = values["standalone"] === true;
  if (row !== undefined && standalone) {
    return err(HandPostArgsErrors.formsBoth());
  }
  if (row === undefined && !standalone) {
    return err(HandPostArgsErrors.formMissing());
  }
  return ok(row);
}

/**
 * Which tier the poster put the step in: a check-in, or work it blocks. Exactly one, never inferred.
 *
 * `checkIn` absent used to mean "blocks", so a dogfood step whose poster forgot `--check-in` ranked above every
 * real check-in on every surface: when the owner asked where to start to clear the important stuff first, the
 * voice led with a voice-parity dogfood step as its `top`, because the step read as a blocker. Forgetting is a
 * refusal, not a tier.
 *
 * @param values every parsed flag
 * @returns whether the step is a check-in, or the refusal naming both flags
 */
function tierForm({ values }: { values: Readonly<Record<string, unknown>> }): Result<boolean, HandPostArgsError> {
  const checkIn = values["check-in"] === true;
  const blocks = values["blocks"] === true;
  if (checkIn && blocks) {
    return err(HandPostArgsErrors.tiersBoth());
  }
  if (!checkIn && !blocks) {
    return err(HandPostArgsErrors.tierMissing());
  }
  return ok(checkIn);
}

/**
 * The address the note opens: `--open` minted into a console deep link, or `--url` with the step's context
 * carried onto a queue link that lacks one.
 *
 * A note's Open must not land on a page the work context hides: a link naming a Slopweaver row carries its
 * context, so a link the fleet mints always carries it.
 *
 * @param values every parsed flag
 * @param base the console origin
 * @returns the address, `undefined` when neither flag was given, or the refusal
 */
function linkOf({
  values,
  base,
}: {
  values: Readonly<Record<string, unknown>>;
  base: string;
}): Result<string | undefined, HandPostArgsError> {
  const open = flag({ name: "open", values });
  const url = flag({ name: "url", values });
  const stated = flag({ name: "context", values });
  const context = isLinkContext(stated) ? stated : undefined;
  if (open !== undefined && url !== undefined) {
    return err(HandPostArgsErrors.linksBoth());
  }
  if (open !== undefined) {
    return consoleQueueLink({ base, context, key: open }).mapErr((problems) =>
      HandPostArgsErrors.linkUnmintable({ problems }),
    );
  }
  if (url !== undefined) {
    return ok(withQueueContext({ base, context, url }));
  }
  return ok(undefined);
}

/**
 * The unvalidated step the flags describe; `buildHandStep` is what judges it.
 *
 * @param fields the four required flags, already present
 * @param nowIso stamps the step when `--posted-iso` did not
 * @param url the address `linkOf` settled on
 * @param shot the picture `--shot` carries, when it was passed
 * @param values every parsed flag
 * @returns the draft
 */
export function handPostDraft({
  fields,
  nowIso,
  url,
  shot,
  values,
}: {
  fields: { id: string; what: string; unblocks: string; witness: string };
  nowIso: string;
  url: string | undefined;
  shot: HandShot | undefined;
  values: Readonly<Record<string, unknown>>;
}): HandStepDraft {
  const cites = flag({ name: "cites", values });
  const row = flag({ name: "row", values });
  const checklist = flag({ name: "checklist", values });
  const recheck = flag({ name: "recheck", values });
  return {
    ...fields,
    ...(row === undefined ? {} : { row }),
    // `handPostInputs` already refused a value that does not parse; the raw string here would fail the step's own check.
    ...(recheck === undefined
      ? {}
      : {
          recheck: parseRecheckFlag({ value: recheck }).match(
            (parsed): unknown => parsed,
            () => recheck,
          ),
        }),
    ...(shot === undefined ? {} : { shot }),
    ...(checklist === undefined ? {} : { checklist: checklistFlagValue({ raw: checklist }) }),
    ...(values["check-in"] === true ? { checkIn: true } : {}),
    ...(cites === undefined ? {} : { cites: cites.split(",").filter((entry) => entry.trim().length > 0) }),
    context: flag({ name: "context", values }),
    ifIgnored: flag({ name: "if-ignored", values }),
    literal: flag({ name: "literal", values }),
    opened: flag({ name: "opened", values }),
    postedBy: bySession({ values }),
    postedIso: flag({ name: "posted-iso", values }) === undefined ? nowIso : String(values["posted-iso"]),
    unaddressed: flag({ name: "no-address", values }),
    url,
    where: flag({ name: "where", values }),
  };
}

/**
 * The argv read into flags, the four required ones and the note's address — or the exit code that ends the
 * verb, with its diagnostics already written (`--help` answers `EXIT_OK` here, having printed the usage).
 *
 * @param rest the argv tail after `hand post`
 * @param deps the output seams and the console origin
 * @returns the inputs a step is drafted from, or the exit code
 */
export function handPostInputs({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): Result<
  {
    values: Readonly<Record<string, unknown>>;
    fields: { id: string; what: string; unblocks: string; witness: string };
    url: string | undefined;
    shot: ShotFlags | undefined;
  },
  number
> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(POST_USAGE);
    return err(EXIT_OK);
  }
  const parsed = parseHandPostArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(POST_USAGE);
    return err(EXIT_USAGE);
  }
  const values = parsed.value.values;
  const fields = required({ values });
  if (fields === undefined) {
    deps.writeDiagnostic("hand post: --id, --what, --unblocks and --witness are all required");
    deps.writeDiagnostic(POST_USAGE);
    return err(EXIT_USAGE);
  }
  const recheck = flag({ name: "recheck", values });
  const recheckRefusal = recheck === undefined ? undefined : parseRecheckFlag({ value: recheck });
  if (recheckRefusal?.isErr() === true) {
    deps.writeDiagnostic(`hand post: ${recheckRefusal.error.message}`);
    return err(EXIT_USAGE);
  }
  const address = postingForm({ values })
    .andThen(() => tierForm({ values }))
    .andThen(() => shotFlagsOf({ rest, values }))
    .andThen((shot) => linkOf({ base: deps.consoleBase(), values }).map((url) => ({ shot, url })));
  if (address.isErr()) {
    handPostArgsLines({ error: address.error }).forEach((line) => {
      deps.writeDiagnostic(`hand post: ${line}`);
    });
    return err(EXIT_USAGE);
  }
  return ok({ fields, shot: address.value.shot, url: address.value.url, values });
}
