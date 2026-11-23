/**
 * `slopweaver linear attach upload` — the effectful shell. Every decision lives in `./attachCore.ts` and
 * `../../../outbound/linear/attachment.ts`; this file resolves the home and token, routes the effect
 * through the admit door, reserves the slot and lands the bytes.
 *
 * ## The order is the contract
 *
 *   parse → stat → classify → [dry-run stops here] → token → door → privacy → reserve → privacy → PUT → report
 *
 * The dry run stops before EVERY effect — no token resolution, no door record, no network — the same
 * property `./run.ts` states for the issue door. What follows the door is two calls that are ONE operation:
 * `../../../corpus/linear/writeAssets.ts` reserves a slot and hands back an `assetUrl` that 404s until the
 * bytes land, so this verb prints an asset only when the PUT was accepted. That is the whole reason the
 * upload is not simply the mutation.
 */
import { basename } from "node:path";

import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type CandidateVisual, VISUAL_HEAD_BYTES } from "../../../admit/inventedVisual.js";
import {
  INVENTED_VISUAL_OVERRIDE,
  inventedVisualFindings,
  inventedVisualGate,
} from "../../../admit/inventedVisualGate.js";
import type { LinearAssetWriteApi, StoredAsset } from "../../../corpus/linear/writeAssets.js";
import { err, type Result } from "../../../lib/result.js";
import { invalidDatadogHostRefusalLines } from "../../../outbound/invalidDatadogHost.js";
import { putReservedAsset } from "../../../outbound/linear/assetUpload.js";
import { type LinearAttachError, LinearAttachErrors } from "../../../outbound/linear/attach.errors.js";
import {
  type ClassifiedLinearAttachment,
  classifyLinearAttachment,
  embedsInline,
} from "../../../outbound/linear/attachment.js";
import { type LinearWritePrivacy, linearUploadPrivacyRefusal } from "../../../outbound/linear/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  type LinearAttachArgs,
  linearAttachDoorRequest,
  parseLinearAttachArgs,
  uploadedMediaBlock,
} from "./attachCore.js";
import { type LinearAttachDeps, productionLinearAttachDeps } from "./attachDeps.js";
import { LINEAR_ATTACH_USAGE } from "./attachUsage.js";
import { linearVerbErrorLines } from "./errors.js";

/** Same offset `./run.ts` documents: node, script, noun, verb — so the slice begins at the sub-verb. */
const VERB_ARG_OFFSET = 4;

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: LinearAttachDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/**
 * The one candidate visual this door is looking at — the file, its leading bytes and its own directory.
 *
 * Identical in shape to `../github/attachRun.ts`'s, and identical on purpose: the gate judges what a
 * picture claims, and that question does not change because the bytes are going to a different provider.
 */
function attachmentVisual({ deps, path }: { deps: LinearAttachDeps; path: string }): CandidateVisual {
  const bytes = deps.readFileBytes({ path });
  if (bytes.isErr()) {
    return { ref: path, seam: "attachment", siblings: deps.listSiblings({ path }) };
  }
  return visualOfBytes({ bytes: bytes.value, deps, path });
}

/** {@link attachmentVisual} over bytes already read, so the live upload reads its file once. */
function visualOfBytes({
  bytes,
  deps,
  path,
}: {
  bytes: Uint8Array;
  deps: LinearAttachDeps;
  path: string;
}): CandidateVisual {
  return {
    head: bytes.slice(0, VISUAL_HEAD_BYTES),
    ref: path,
    seam: "attachment",
    siblings: deps.listSiblings({ path }),
  };
}

/**
 * The environment the door reads, with this call's acknowledgement folded into the override list.
 *
 * Same reasoning `../github/attachRun.ts` records: a flag waives exactly the upload it is typed on, where
 * an exported `SLOPWEAVER_DOOR_OVERRIDE` would waive every later call in the shell and leave no trace of
 * which one meant it. The door still writes the waived code to the ledger.
 *
 * @param acknowledge the reason the caller gave, when they gave one
 * @returns the process environment, with the override token appended when this call is acknowledged
 */
function acknowledgedEnv({
  acknowledge,
}: {
  acknowledge: string | undefined;
}): Readonly<Record<string, string | undefined>> {
  if (acknowledge === undefined) {
    return process.env;
  }
  const existing = process.env["SLOPWEAVER_DOOR_OVERRIDE"];
  return {
    ...process.env,
    SLOPWEAVER_DOOR_OVERRIDE:
      existing === undefined ? INVENTED_VISUAL_OVERRIDE : `${existing},${INVENTED_VISUAL_OVERRIDE}`,
  };
}

/** The `--dry-run` half: classify locally, print the plan and the gate's verdict, send nothing. */
function reportPlan({
  deps,
  args,
  classified,
}: {
  deps: LinearAttachDeps;
  args: LinearAttachArgs;
  classified: ClassifiedLinearAttachment;
}): void {
  const plan = {
    byteLength: classified.byteLength,
    contentType: classified.contentType,
    embedsInline: embedsInline({ contentType: classified.contentType }),
    fileName: classified.fileName,
    outcome: "would upload",
  };
  if (args.json) {
    deps.out(JSON.stringify(plan, undefined, 2));
    return;
  }
  deps.out(`would upload ${classified.fileName} (${classified.contentType}, ${String(classified.byteLength)} bytes)`);
  deps.out(
    plan.embedsInline
      ? "it would embed inline as an image"
      : "it would render as a file LINK, not inline — only image/* embeds",
  );
  for (const finding of inventedVisualFindings({ visuals: [attachmentVisual({ deps, path: args.file })] })) {
    deps.out(`${finding.code}: ${finding.summary}`);
    deps.out(`  ${finding.correction}`);
  }
}

/** Print a completed upload in the selected output mode. */
function reportUpload({
  deps,
  args,
  asset,
}: {
  deps: LinearAttachDeps;
  args: LinearAttachArgs;
  asset: StoredAsset;
}): void {
  const block = uploadedMediaBlock({ alt: args.alt, asset });
  if (args.json) {
    deps.out(JSON.stringify({ asset, mediaBlock: block, outcome: "uploaded" }, undefined, 2));
    return;
  }
  deps.out(`uploaded ${asset.fileName} (${asset.contentType}, ${String(asset.byteLength)} bytes)`);
  deps.out(asset.assetUrl);
  // The BLOCK, not rendered markdown: `../../../outbound/linear/render.ts` owns how a media block becomes
  // text, and a second renderer here is a second thing to keep in step with it.
  deps.out(`media block: ${JSON.stringify(block)}`);
}

/** Reserve the slot and land the bytes. Runs ONLY when the door passed. */
async function performUpload({
  api,
  bytes,
  classified,
  deps,
  privacy,
}: {
  api: LinearAssetWriteApi;
  bytes: Uint8Array;
  classified: ClassifiedLinearAttachment;
  deps: LinearAttachDeps;
  privacy: LinearWritePrivacy;
}): Promise<Result<StoredAsset, LinearAttachError>> {
  // Any file can carry a link: its bytes and name are judged for a dead Datadog host before a slot is reserved.
  const refusal = invalidDatadogHostRefusalLines({
    command: `linear attach upload ${classified.fileName}`,
    payload: { file: bytes, fileName: classified.fileName },
  });
  if (refusal !== undefined) {
    return err(LinearAttachErrors.deadDatadogHost({ refusal }));
  }
  // The privacy check judges the name and text-like bytes before a slot is reserved, and again before the PUT.
  const privacyRefusal = await linearUploadPrivacyRefusal({ bytes, fileName: classified.fileName, privacy });
  if (privacyRefusal !== undefined) {
    return err(LinearAttachErrors.privacyRefused({ refusal: privacyRefusal }));
  }
  const reserved = await api.reserveUpload({
    byteLength: classified.byteLength,
    contentType: classified.contentType,
    fileName: classified.fileName,
  });
  if (reserved.isErr()) {
    return err(LinearAttachErrors.uploadRefused({ cause: reserved.error, reason: reserved.error.message }));
  }
  // The PUT is addressed and signed by what Linear handed back, so the whole reservation is judged too (the same
  // class Codex reviews found in GitHub's upload policy).
  const reservedRefusal = invalidDatadogHostRefusalLines({
    command: `linear attach upload ${classified.fileName}`,
    payload: reserved.value,
  });
  if (reservedRefusal !== undefined) {
    return err(LinearAttachErrors.deadDatadogHost({ refusal: reservedRefusal }));
  }
  return putReservedAsset({ bytes, classified, fetchImpl: deps.putFetch, privacy, reservation: reserved.value });
}

/** The effect phase: token, door, reserve, PUT. */
async function runLive({
  args,
  classified,
  deps,
  home,
}: {
  args: LinearAttachArgs;
  classified: ClassifiedLinearAttachment;
  deps: LinearAttachDeps;
  home: string;
}): Promise<number> {
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  const bytes = deps.readFileBytes({ path: args.file });
  if (bytes.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [bytes.error.message] });
  }
  const routed = await throughDoor({
    env: acknowledgedEnv({ acknowledge: args.acknowledge }),
    gates: [inventedVisualGate({ visuals: [visualOfBytes({ bytes: bytes.value, deps, path: args.file })] })],
    home,
    ledger: deps.doorLedger,
    perform: () =>
      performUpload({
        api: deps.makeApi({ home, token }),
        bytes: bytes.value,
        classified,
        deps,
        privacy: deps.privacy({ home }),
      }),
    request: linearAttachDoorRequest({
      byteLength: classified.byteLength,
      contentType: classified.contentType,
      fileName: classified.fileName,
      home,
    }),
  });
  reportWaivers({ acknowledge: args.acknowledge, deps, overridden: routed.decision.overridden });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear attach", through: routed })],
    });
  }
  if (routed.result.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [routed.result.error.message] });
  }
  reportUpload({ args, asset: routed.result.value, deps });
  return EXIT_OK;
}

/**
 * Say which gate findings this call waived, and with what reason.
 *
 * The reason itself never reaches the ledger — `../../../admit/ledger.ts` records the action, the effect, the
 * status and the codes and deliberately nothing else — so it is printed here, where the person taking the
 * decision reads it.
 *
 * @param acknowledge the reason the caller gave, when they gave one
 * @param overridden the findings the door let through because of it
 * @param deps the injected output sink
 */
function reportWaivers({
  acknowledge,
  overridden,
  deps,
}: {
  acknowledge: string | undefined;
  overridden: readonly { readonly code: string }[];
  deps: LinearAttachDeps;
}): void {
  if (acknowledge === undefined) {
    return;
  }
  for (const finding of overridden) {
    deps.err(`${finding.code} waived: ${acknowledge}`);
  }
}

/**
 * Run `linear attach upload`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearAttach({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearAttachDeps;
}): Promise<number> {
  const parsed = parseLinearAttachArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({
      code: EXIT_USAGE,
      deps,
      lines: [...linearVerbErrorLines({ error: parsed.error }), LINEAR_ATTACH_USAGE],
    });
  }
  const args = parsed.value;
  const size = deps.fileSize({ path: args.file });
  if (size.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [size.error.message] });
  }
  const classified = classifyLinearAttachment({ byteLength: size.value, fileName: basename(args.file) });
  if (classified.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [classified.error.message] });
  }
  if (args.dryRun) {
    // Stops here, before every effect. Nothing resolved, nothing recorded, nothing sent.
    reportPlan({ args, classified: classified.value, deps });
    return EXIT_OK;
  }
  return runLive({ args, classified: classified.value, deps, home: resolveHome({ named: args.home }) });
}

/** `slopweaver linear attach` — upload one local asset to Linear's own storage, through the door. */
export const linearAttachCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearAttach({ argv, deps: productionLinearAttachDeps() }),
});
