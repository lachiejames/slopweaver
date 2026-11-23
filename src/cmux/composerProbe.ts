/**
 * Whether a Claude Code composer is on a surface — the one witness `cmux spawn` and `cmux reseat` may report a
 * booted seat on — kept apart from a read that FAILED.
 *
 * ## Why two kinds of "no composer"
 *
 * `./composer.ts` answers `unreadable` both when cmux would not hand the grid over and when it handed one over that
 * holds no composer. Those mean opposite things. A grid that will not read under load says nothing about the seat:
 * a false negative is a loaded surface whose reads failed while the session was fine, so a spawn whose
 * every read failed after `SessionStart` fired keeps its honest `unwitnessed` success. A grid that READ and shows a
 * zsh prompt, or Claude's `No conversation found` line, is positive evidence of a failed boot. MEASURED:
 * `cmux reseat` reported "reseated" over exactly that screen, and the fleet sat at four empty tabs.
 */
import type { CmuxClient } from "./client.js";
import { type ComposerReading, readComposer } from "./composer.js";

/** One read of the styled grid: what it showed, or why cmux would not hand it over. */
export type ComposerProbe =
  | { readonly kind: "read"; readonly reading: ComposerReading }
  | { readonly kind: "read-failed"; readonly reason: string };

/** A composer reading that positively recognised Claude Code's prompt box. */
export type WitnessedComposer = Exclude<ComposerReading, { readonly kind: "unreadable" }>;

/** How one Claude boot came out, judged over every composer probe it took. */
export type ClaudeBootDecision =
  /** A Claude composer was read on the surface. */
  | { readonly kind: "composer"; readonly reading: WitnessedComposer }
  /** Every grid read failed, and the boot itself was witnessed: an honest success nobody saw the box of. */
  | { readonly kind: "unwitnessed" }
  /**
   * The surface read and showed no composer, showed the missing-conversation line, or never read at all with
   * nothing else vouching for the boot: the boot failed.
   */
  | {
      readonly kind: "failed";
      readonly reason: "missing-conversation" | "readable-without-composer" | "never-read";
    };

/**
 * Read the styled grid once, keeping a failed read apart from a read that found no composer.
 *
 * @param client the cmux call the read goes through
 * @param target the surface to read
 * @returns the probe
 */
export async function probeComposer({
  client,
  target,
}: {
  client: Pick<CmuxClient, "readScreenGrid">;
  target: { readonly workspaceId: string; readonly surfaceId?: string };
}): Promise<ComposerProbe> {
  const grid = await client.readScreenGrid({
    target: target.surfaceId === undefined ? { workspaceId: target.workspaceId } : target,
  });
  if (grid.isErr()) {
    return { kind: "read-failed", reason: `the styled grid could not be read: ${grid.error.message}` };
  }
  return { kind: "read", reading: readComposer({ grid: grid.value }) };
}

/**
 * The composer a probe positively recognised, or `undefined` for a failed read or a surface with no composer.
 *
 * @param probe one grid read
 * @returns the witnessed reading
 */
export function witnessedComposer({ probe }: { probe: ComposerProbe }): WitnessedComposer | undefined {
  if (probe.kind !== "read" || probe.reading.kind === "unreadable") {
    return undefined;
  }
  return probe.reading;
}

/**
 * Whether a probe READ the grid and found no composer on it — positive evidence of no Claude prompt box, which a
 * failed read is not. A missing-conversation exit is counted only beside this, never beside a grid that would not
 * read, which may hold a live composer.
 *
 * @param probe one grid read
 * @returns true when the grid read and held no composer
 */
export function gridReadWithoutComposer({ probe }: { probe: ComposerProbe }): boolean {
  return probe.kind === "read" && probe.reading.kind === "unreadable";
}

/**
 * Decide one Claude boot over every probe it took.
 *
 * A missing-conversation line fails it outright. Any recognised composer witnesses it. A grid that READ and held no
 * composer fails it: a zsh prompt is positive evidence. Only when EVERY probe failed to read does the boot witness
 * (`SessionStart`, or the banner) vouch for it, `unwitnessed` — a loaded surface, kept a success.
 *
 * @param probes every grid read, oldest first
 * @param bootWitnessed whether the boot itself was witnessed — a `SessionStart` hook or Claude's banner
 * @param missingConversationSeen whether a NEW missing-conversation line appeared since the launch was typed
 * @returns the decision
 */
export function decideClaudeBoot({
  probes,
  bootWitnessed,
  missingConversationSeen,
}: {
  probes: readonly ComposerProbe[];
  bootWitnessed: boolean;
  missingConversationSeen: boolean;
}): ClaudeBootDecision {
  if (missingConversationSeen) {
    return { kind: "failed", reason: "missing-conversation" };
  }
  const witnessed = probes.map((probe) => witnessedComposer({ probe })).find((reading) => reading !== undefined);
  if (witnessed !== undefined) {
    return { kind: "composer", reading: witnessed };
  }
  if (probes.some((probe) => probe.kind === "read")) {
    return { kind: "failed", reason: "readable-without-composer" };
  }
  return bootWitnessed ? { kind: "unwitnessed" } : { kind: "failed", reason: "never-read" };
}

/**
 * The words a failed boot is reported with.
 *
 * @param reason why the boot failed
 * @returns the clause
 */
export function failedBootClause({
  reason,
}: {
  reason: Extract<ClaudeBootDecision, { readonly kind: "failed" }>["reason"];
}): string {
  switch (reason) {
    case "missing-conversation":
      return "Claude printed `No conversation found with session ID` and exited — the session had no transcript to resume";
    case "readable-without-composer":
      return "the surface read, and no Claude composer was on it";
    case "never-read":
      return "the surface never read, and nothing else vouched for the boot";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
