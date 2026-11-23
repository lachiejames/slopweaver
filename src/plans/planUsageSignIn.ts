/**
 * Whether the store a `plans usage` row names is signed in, off recorded evidence only. Pure.
 *
 * `ok` only on positive evidence about the store the row names NOW: a Claude probe record for that store that last
 * answered `ok`, or a Codex live-read observation filed for that home against the same `auth.json` stamp. An
 * `auth.json` that merely exists is `unknown` (`../codex/auth.ts`: presence proves a sign-in happened, not that it is
 * still accepted). `needs-sign-in` is said only when a recorded fault or the store's own files show it.
 */
import { type ClaudePlanProbeRecord, isSignInFault } from "../claude/planProbeRecord.js";
import type { CodexSignInAliasRead } from "../codex/signInPort.js";
import { sameCodexAuthStamp } from "../codex/signInRecord.js";

import type { CodexStoreFiles, PlanSignInSource, PlanUsageRead, PlanUsageSignIn } from "./planUsageTypes.js";
import type { RegisteredPlan } from "./types.js";

/**
 * A Claude row's sign-in, from its last probe record — only a record for the store the row names now counts.
 *
 * @param plan the register row, whose store the record must name
 * @param probe the shared probe read's answer for this row
 * @returns the verdict
 */
export function claudeSignIn({
  plan,
  probe,
}: {
  plan: RegisteredPlan;
  probe: PlanUsageRead<ClaudePlanProbeRecord | undefined>;
}): PlanUsageSignIn {
  const source: PlanSignInSource = "claude-gauge-probe";
  if (probe.kind === "unreadable") {
    return { kind: "unknown", observedAtIso: null, reason: probe.reason, source };
  }
  const record = probe.value;
  if (record === undefined) {
    return { kind: "unknown", observedAtIso: null, reason: "no probe of this plan is recorded", source };
  }
  if (record.storeDir !== plan.storeDir) {
    return {
      kind: "unknown",
      observedAtIso: record.observedAtIso,
      reason: "the last probe read a different store than the one this plan names",
      source,
    };
  }
  if (record.fault !== undefined) {
    if (isSignInFault({ code: record.fault.code })) {
      return { kind: "needs-sign-in", observedAtIso: record.fault.lastSeenIso, reason: record.fault.message, source };
    }
    return { kind: "unknown", observedAtIso: record.fault.lastSeenIso, reason: record.fault.message, source };
  }
  if (record.latest === "ok") {
    return { kind: "ok", observedAtIso: record.observedAtIso, source };
  }
  let reason = "the last probe reached no verdict";
  if (record.unmeasuredBecause !== undefined) {
    reason = `${reason}: ${record.unmeasuredBecause}`;
  }
  return { kind: "unknown", observedAtIso: record.observedAtIso, reason, source };
}

/**
 * What a Codex store's own files settle with no live read: `needs-sign-in` when the filesystem says the store or its
 * `auth.json` is not there, or the file holds no sign-in; `unknown` when either is there but could not be read or
 * parsed, which says nothing either way.
 *
 * @returns the verdict the files settle, or `undefined` when they hold a sign-in and a live read decides
 */
function codexFilesVerdict({ files }: { files: CodexStoreFiles }): PlanUsageSignIn | undefined {
  const source: PlanSignInSource = "codex-store-files";
  let gap: string | undefined;
  if (files.store.kind === "missing") {
    gap = "the store directory is missing";
  } else if (files.store.kind === "unreadable") {
    return { kind: "unknown", observedAtIso: null, reason: files.store.reason, source };
  } else if (files.authFile.kind === "missing") {
    gap = "auth.json is absent";
  } else if (files.authFile.kind === "unreadable") {
    return { kind: "unknown", observedAtIso: null, reason: files.authFile.reason, source };
  } else if (!files.auth.readable) {
    return { kind: "unknown", observedAtIso: null, reason: "auth.json is there but could not be parsed", source };
  } else if (!files.auth.hasTokens && !files.auth.hasApiKey) {
    gap = "auth.json holds no sign-in";
  }
  if (gap === undefined) {
    return undefined;
  }
  return { kind: "needs-sign-in", observedAtIso: null, reason: gap, source };
}

/**
 * A Codex row's sign-in: the store's own files first ({@link codexFilesVerdict}), then the last live read filed for
 * this home against the same `auth.json`.
 *
 * @param files the store's own files, read this report
 * @param plan the register row, whose home the filed read must name
 * @param signIn what the store holds for this alias's last live read
 * @returns the verdict
 */
export function codexSignIn({
  files,
  plan,
  signIn,
}: {
  files: CodexStoreFiles;
  plan: RegisteredPlan;
  signIn: PlanUsageRead<CodexSignInAliasRead>;
}): PlanUsageSignIn {
  const settled = codexFilesVerdict({ files });
  if (settled !== undefined) {
    return settled;
  }
  const source: PlanSignInSource = "codex-live-read";
  if (signIn.kind === "unreadable") {
    return { kind: "unknown", observedAtIso: null, reason: signIn.reason, source };
  }
  const filed = signIn.value;
  if (filed.kind === "refused") {
    return { kind: "unknown", observedAtIso: null, reason: filed.error.message, source };
  }
  if (filed.kind === "absent") {
    return { kind: "unknown", observedAtIso: null, reason: "no live read of this store is filed", source };
  }
  const { record } = filed;
  const sameStore = record.codexHome === plan.storeDir;
  if (!sameStore || !sameCodexAuthStamp({ left: record.authStamp, right: files.authStamp })) {
    return {
      kind: "unknown",
      observedAtIso: record.readAtIso,
      reason: "auth.json changed since the last live read",
      source,
    };
  }
  if (record.state === "signed-in") {
    return { kind: "ok", observedAtIso: record.readAtIso, source };
  }
  return {
    kind: "needs-sign-in",
    observedAtIso: record.readAtIso,
    reason:
      record.state === "store-missing" ? "the last live read found no store" : "the last live read found it signed out",
    source,
  };
}
