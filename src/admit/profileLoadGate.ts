/**
 * The gate that refuses an outward write from a session the owner's profile never reached.
 *
 * A session can only act as the owner if it can load the owner's profile, and a failure to is loud. Every external
 * write leaves through `throughDoor`, so this is the one
 * place a session acting for the owner — a Slack post, a GitHub comment, a Linear write, a card — can be stopped by
 * construction rather than by a session noticing what its boot block said.
 *
 * ## What it reads, and what it will not conclude
 *
 * The calling session's ids come from its environment (`currentSessionIds`); a call naming none — a recipe, a
 * script, a terminal — is not a session acting as the owner, and passes. For a session, the verdict is
 * `../context/loadLedger.ts`'s: its newest observation across the load ledger and its own transcript's boot
 * records. **Only POSITIVE evidence refuses.** A session with no observation at all passes, because every failure
 * this lane can name leaves a record and a refusal built on silence would wedge every seat booted before the
 * ledger existed while proving nothing. A source that is there and could not be read is not silence, though: that
 * refuses too, under the same token, saying which source.
 *
 * ## Why a `hold`, with no override
 *
 * Doing nothing beats acting misaligned for the owner. A `warn` would carry a token that lets a session without the
 * owner's profile write as the owner anyway; that is exactly the act ruled out,
 * so the finding is a `hold`, which no per-action token waives. It costs the session no wait on the owner: the repair is
 * still one command it runs itself (`slopweaver profile context`), and the PreToolUse `profile-held` check
 * (`./profileHeld.ts`) has usually delivered the profile before a write gets this far.
 *
 * This hold is the SECOND line, and deliberately does not deliver. A write a session makes runs inside a guarded tool
 * call, which `profile-held` already held, delivered and marked; a write reaching the door with no PreToolUse in front
 * of it has no model context to deliver into, so it is refused and names the reload, and the `profile-unloaded`
 * monitor reads that session by its newest observation (`not yet held`) until a guarded call meets it. Residue, not
 * closed: a session whose newest record is this door hold is never shown as a reload in flight.
 *
 * ## A first boot is not held
 *
 * With no profile yet there is nothing to hold, and onboarding must never trap
 * anyone. A machine the owner's profile was never written, cached or loaded on (`./profileFirstBoot.ts`) records an unloaded boot
 * that lost nothing, and its `profile context` records no row to clear one — so an unloaded session there is
 * `first-boot` evidence and passes. The hold still stands the moment any trace of a configured home exists.
 */
import { slopweaverHome } from "../config.js";
import { PROFILE_RELOAD_COMMAND, type SessionLoadVerdict, sessionLoadVerdict } from "../context/loadLedger.js";
import { sessionLoadObservations } from "../context/loadLedgerStore.js";
import { currentSessionIds } from "../handover/runOwner.js";
import { claudeProjectsDir } from "../transcripts/source.js";
import { firstBootSessionSeen } from "./firstBootSession.js";
import { machineDefaultHomes, machineNeverConfigured } from "./profileFirstBoot.js";
import type { DoorFinding, DoorGate, DoorRequest } from "./types.js";

/** What the gate knows about the calling session before it decides. */
export type ProfileLoadEvidence =
  | { readonly kind: "no-session" }
  | { readonly kind: "first-boot" }
  | { readonly kind: "configured-after-first-boot" }
  | { readonly kind: "unreadable"; readonly problems: readonly string[] }
  | { readonly kind: "read"; readonly verdict: SessionLoadVerdict };

/**
 * The findings one request carries, given what is known about the session that made it.
 *
 * @param request the door request — only an `external-write` is a session acting outward as the owner
 * @param evidence the calling session's load evidence
 * @returns one `hold` when the session does not hold the owner's profile or that cannot be told; empty otherwise
 */
export function profileLoadFindings({
  request,
  evidence,
}: {
  request: DoorRequest;
  evidence: ProfileLoadEvidence;
}): readonly DoorFinding[] {
  if (request.meta.effect !== "external-write" || evidence.kind === "no-session" || evidence.kind === "first-boot") {
    return [];
  }
  if (evidence.kind === "configured-after-first-boot") {
    return [
      {
        code: "PROFILE_NOT_LOADED",
        correction: `run \`${PROFILE_RELOAD_COMMAND}\` in this session and read what it prints; once it exits 0 the load is recorded and this write may go`,
        severity: "hold",
        summary:
          "this session began on a first boot and the machine has since been configured, so the owner's profile now exists and was never loaded here; a session without it may not act as the owner",
      },
    ];
  }
  if (evidence.kind === "unreadable") {
    return [
      {
        code: "PROFILE_LOAD_UNREADABLE",
        correction: `run \`${PROFILE_RELOAD_COMMAND}\` in this session — a load it records answers the question — or repair the source named here`,
        severity: "hold",
        summary: `whether this session holds the owner's profile could not be read, so it may not act as the owner: ${evidence.problems.join("; ")}`,
      },
    ];
  }
  if (evidence.verdict.kind !== "unloaded") {
    return [];
  }
  const { latest } = evidence.verdict;
  return [
    {
      code: "PROFILE_NOT_LOADED",
      correction: `run \`${PROFILE_RELOAD_COMMAND}\` in this session and read what it prints; once it exits 0 the load is recorded and this write may go`,
      severity: "hold",
      summary: `the owner's profile did not load into session ${latest.sessionId} (${latest.atIso}: ${latest.why}), and a session without it may not act as the owner`,
    },
  ];
}

/**
 * Read the calling session's load evidence.
 *
 * @param env the environment the session ids are read from
 * @param home the state home whose ledger is read
 * @param projectsDir where Claude Code keeps transcripts
 * @param neverConfigured whether the owner's profile was never written, cached or loaded on this machine — asked only of an unloaded
 *   or unobserved session or one whose evidence could not be read, since on a first boot there is no profile any of
 *   them could have lost
 * @param firstBootSeen whether one of these sessions was let through on a first boot (`./firstBootSession.ts`) —
 *   asked only of an unobserved session on a machine no longer a first boot
 * @returns the evidence — never an `err`, since a source that could not be read IS evidence
 */
export function readProfileLoadEvidence({
  env,
  home,
  projectsDir,
  neverConfigured,
  firstBootSeen,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  projectsDir: string;
  neverConfigured: () => boolean;
  firstBootSeen: (input: { sessionIds: readonly string[] }) => boolean;
}): ProfileLoadEvidence {
  const sessionIds = currentSessionIds({ env });
  if (sessionIds.length === 0) {
    return { kind: "no-session" };
  }
  return sessionLoadObservations({ home, projectsDir, sessionIds }).match<ProfileLoadEvidence>(
    (read) => {
      const verdict = sessionLoadVerdict({ observations: read, sessionIds });
      if (verdict.kind === "unloaded" && neverConfigured()) {
        return { kind: "first-boot" };
      }
      // A first boot records no load, so a session it let through reads unobserved — the door's historical pass. Once
      // the machine is configured, that session holds a profile it never loaded.
      if (verdict.kind === "unobserved" && firstBootSeen({ sessionIds }) && !neverConfigured()) {
        return { kind: "configured-after-first-boot" };
      }
      return { kind: "read", verdict };
    },
    (problems) => (neverConfigured() ? { kind: "first-boot" } : { kind: "unreadable", problems }),
  );
}

/**
 * The gate `throughDoor` composes onto every request it admits, with the session's evidence read ONCE up front —
 * a gate is a pure function of its request, so the reading happens here and the closure only decides.
 *
 * @param env the environment the door was called with
 * @param home the ledger home the door was called with, `undefined` for the resolved one
 * @returns the gate
 */
export function profileLoadGate({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string | undefined;
}): DoorGate {
  let evidence: ProfileLoadEvidence | undefined;
  const evidenceOnce = (): ProfileLoadEvidence => {
    if (evidence !== undefined) {
      return evidence;
    }
    const resolved = ledgerHome({ home });
    evidence = readProfileLoadEvidence({
      env,
      home: resolved,
      // Every home a first boot marks, so a call that re-pointed its home at a default one is still found; an account the user database cannot name leaves the resolved home alone.
      firstBootSeen: ({ sessionIds }) => {
        const defaults = machineDefaultHomes();
        const homes = defaults.isOk() ? [resolved, ...defaults.value] : [resolved];
        return firstBootSessionSeen({ homes, sessionIds });
      },
      neverConfigured: () => machineNeverConfigured({ home: resolved }),
      projectsDir: claudeProjectsDir(),
    });
    return evidence;
  };
  return (request) => {
    if (request.meta.effect !== "external-write") {
      return [];
    }
    return profileLoadFindings({ evidence: evidenceOnce(), request });
  };
}

/** The home the door was called with, or the resolved one when it named none. */
function ledgerHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}
