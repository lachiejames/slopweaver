/**
 * The PURE core of `slopweaver linear attach` — argument parsing, usage, the door request, and the two
 * report shapes. No I/O, so all of it is unit-testable without a mock.
 *
 * ## One sub-verb, where `github attach` has two
 *
 * GitHub's attach carries a `status` sub-verb because its upload rides the owner's own Chrome session, so
 * "which account am I signed in as, and for how long" is a real question with a real answer. Linear's does
 * not: `mutation.fileUpload` is a plain API-key call, the same credential every other verb on this noun
 * already uses, and there is no session to report on. `upload` is still spelled out rather than folded into
 * a bare `attach <file>` — the shape `github attach` set — because it is the word that makes an external
 * write visible at the call site.
 *
 * ## Why the invented-visual gate applies here too
 *
 * An image uploaded to Linear ends up in front of a colleague exactly the way one uploaded to GitHub does.
 * The gate is about what a picture CLAIMS, not about which provider stores it, so the same three refusals
 * and the same `--acknowledge` waiver apply — see `../../../admit/inventedVisual.ts`.
 */
import { ACKNOWLEDGEMENT_MIN_WORDS, acknowledgementCarriesAReason } from "../../../admit/inventedVisual.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { StoredAsset } from "../../../corpus/linear/writeAssets.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { mediaBlockFor } from "../../../outbound/linear/attachment.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

/** The flags this verb accepts, as a {@link FlagSpec}. */
const LINEAR_ATTACH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["file", "alt", "home", "acknowledge"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_ATTACH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_ATTACH_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_ATTACH_FLAGS }),
].map((name) => `--${name}`);

/** A parsed `linear attach upload` invocation. */
export interface LinearAttachArgs {
  readonly file: string;
  readonly alt: string | undefined;
  readonly acknowledge: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * The Linear media block an upload embeds as. Its alt text is the `--alt` value when it was passed, else the
 * uploaded file's own name, which is the default `attachUsage.ts` documents for an unpassed `--alt`.
 *
 * @param alt the `--alt` value, `undefined` when the flag was not passed
 * @param asset the stored upload, whose URL, content type and file name the block carries
 * @returns the media block to embed
 */
export function uploadedMediaBlock({
  alt,
  asset,
}: {
  alt: string | undefined;
  asset: Pick<StoredAsset, "assetUrl" | "contentType" | "fileName">;
}): ReturnType<typeof mediaBlockFor> {
  if (alt === undefined) {
    // --alt not passed: the documented default is the file's own name.
    return mediaBlockFor({ alt: asset.fileName, assetUrl: asset.assetUrl, contentType: asset.contentType });
  }
  return mediaBlockFor({ alt, assetUrl: asset.assetUrl, contentType: asset.contentType });
}

/**
 * Parse `linear attach upload …`.
 *
 * Every usage problem is collected rather than reported one at a time, matching `github attach`'s parser —
 * a caller fixing a command line wants the whole list, not one round trip per mistake.
 *
 * @param rest argv after `linear attach`
 * @returns the parsed invocation, or every usage problem
 */
export function parseLinearAttachArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<LinearAttachArgs, LinearVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: LINEAR_ATTACH_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const [subVerb, ...extra] = parsed.value.positionals;
  if (subVerb === undefined) {
    return err(LinearVerbErrors.attachSubVerbMissing());
  }
  if (subVerb !== "upload") {
    return err(LinearVerbErrors.attachSubVerbUnknown({ got: subVerb }));
  }
  if (extra.length > 0) {
    return err(LinearVerbErrors.attachExtraArgument({ got: String(extra[0]) }));
  }
  return parseUploadArgs({ values: parsed.value.values });
}

/** The `upload` inputs, split from the sub-verb routing so neither carries the other's branching. */
function parseUploadArgs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<LinearAttachArgs, LinearVerbError> {
  const fileValue = values["file"];
  if (typeof fileValue !== "string") {
    return err(LinearVerbErrors.attachFileMissing());
  }
  const ackValue = values["acknowledge"];
  const acknowledge = typeof ackValue === "string" ? ackValue : undefined;
  if (acknowledge !== undefined && !acknowledgementCarriesAReason({ reason: acknowledge })) {
    return err(LinearVerbErrors.acknowledgementTooShort({ got: acknowledge, minWords: ACKNOWLEDGEMENT_MIN_WORDS }));
  }
  const altValue = values["alt"];
  const homeValue = values["home"];
  return ok({
    acknowledge,
    alt: typeof altValue === "string" ? altValue : undefined,
    dryRun: values["dry-run"] === true,
    file: fileValue,
    home: typeof homeValue === "string" ? homeValue : undefined,
    json: values["json"] === true,
  });
}

/**
 * The door request for one asset upload.
 *
 * `createsWorkItem` is FALSE and `requiresApproval` is FALSE, matching `github attach upload`: an asset in
 * storage notifies nobody and creates nothing to triage. It becomes visible only when a later comment,
 * issue or project-update write — each approval-gated in its own right — embeds the URL.
 *
 * @param home the resolved state home
 * @param fileName the base name of the file being sent, recorded so the audit trail says what left
 * @param contentType what Linear will store the asset as
 * @param byteLength the exact size sent, which is what Linear reserves the slot for
 * @returns the request to admit
 */
export function linearAttachDoorRequest({
  home,
  fileName,
  contentType,
  byteLength,
}: {
  home: string;
  fileName: string;
  contentType: string;
  byteLength: number;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "attach upload" },
    artifact: { byteLength: String(byteLength), contentType, fileName },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
