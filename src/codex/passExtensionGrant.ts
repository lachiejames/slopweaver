/**
 * Who may record a review-pass extension (`./passExtension.ts`): the pinned supervisor, and nobody else. A seat
 * never grants itself one — the owner's own words on the ruling the register carries.
 *
 * ## Why not `hand post`'s seat check
 *
 * `../hand/seatPost.ts` answers a narrower question — may this session draw a note — and is deliberately INERT with
 * no pin recorded, inert with no session identity, and admits any caller sharing the pinned cmux workspace. Each
 * of those is right for a note and wrong for minting review authority, so this verdict refuses all three: no pin,
 * an unreadable pin, no session identity, a Claude and a Codex identity at once, or any other holder. Only an exact
 * host-and-id match with the pin record passes, so a Codex-hosted chair passes on its thread id exactly as a Claude
 * chair passes on its session id.
 *
 * ## What it cannot tell apart
 *
 * An Agent-tool child inherits its parent's session environment, so the chair's own subagent records as the chair.
 * That is read as acting under the chair's authority; no primitive here tells the two apart. A seat's subagent
 * carries the seat's identity and is refused like the seat.
 *
 * The residue, stated rather than discovered: the session identity is an environment variable and the register is a
 * file the owner's user can write, so a same-user process can set `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID` to
 * the pinned id, or append a row directly. The protection is partial on purpose, as `.claude/rules/journalled-grants.md`
 * states for every row of this kind. What it removes is the vague self-grant: a row names one exact diff, so an
 * over-grant admits one pass and no more, and every row stays in the register for an audit to find.
 *
 * The gate narrows what a same-user write reaches: it honours a row only when its `grantedBy` holds the pin in the
 * home the gate reads, and the store refuses a register whose directory is a symbolic link, so a row minted under a
 * caller-chosen `--home` whose pin names the caller approves nothing in the real one.
 *
 * There is deliberately no hatch: a hatch any session could set is the self-grant this verdict exists to refuse,
 * and the gate's past-cap refusal is a hold for the same reason. `SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1` opens
 * only a review fold that cannot be read.
 *
 * Pure: the caller reads the pin and the environment.
 */
import { isRegisteredSupervisor, supervisorPinLabel } from "../sessions/supervisorPin.js";
import type { SupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import type { SupervisorSessionDetection, VisibleSupervisorSession } from "../supervisor/session.js";

/** Whether this session may record an extension, and as whom. */
export type PassExtensionGrantVerdict =
  | { readonly kind: "allowed"; readonly grantedBy: VisibleSupervisorSession }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Judge the session asking to record an extension against the supervisor-pin record.
 *
 * @param pin the pin file, read strictly — absent, a record, or unreadable
 * @param detection which visible session the caller's environment names
 * @returns allowed with the grantor, or refused with the sentence naming why
 */
export function passExtensionGrantVerdict({
  pin,
  detection,
}: {
  pin: SupervisorPinDisposition;
  detection: SupervisorSessionDetection;
}): PassExtensionGrantVerdict {
  if (pin.kind === "absent") {
    return { kind: "refused", reason: "no supervisor pin is recorded, so no session is the chair that may grant one" };
  }
  if (pin.kind === "unreadable") {
    return { kind: "refused", reason: `${pin.why}, so which session is the chair cannot be told` };
  }
  if (detection.kind === "missing") {
    return {
      kind: "refused",
      reason: "this process names no Claude Code session or Codex thread, so it cannot be shown to be the chair",
    };
  }
  if (detection.kind === "ambiguous") {
    return {
      kind: "refused",
      reason: "this process names both a Claude Code session and a Codex thread, so which one is asking is unknown",
    };
  }
  if (!isRegisteredSupervisor({ record: pin.record, session: detection.session })) {
    return {
      kind: "refused",
      reason:
        `the pinned supervisor is ${supervisorPinLabel({ pin: pin.record })}, and this is ${detection.session.host} ` +
        `${detection.session.id} — a seat never grants itself a pass`,
    };
  }
  return { grantedBy: detection.session, kind: "allowed" };
}
