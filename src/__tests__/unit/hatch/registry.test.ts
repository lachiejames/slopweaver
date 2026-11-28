import { describe, expect, it } from "vitest";
import { hatchFor, REGISTERED_DOOR_TOKENS, REGISTERED_ENV_VARIABLES } from "../../../hatch/lookup.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { type EscapeHatch, hatchEnvVar, hatchIncantation } from "../../../hatch/types.js";

describe("the escape-hatch register", () => {
  it("gives every hatch a unique id", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every hatch a unique key", () => {
    const keys = ESCAPE_HATCHES.map((hatch) => hatchIncantation({ hatch }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every hatch at least one legitimate exception", () => {
    const lengths = ESCAPE_HATCHES.map((hatch) => hatch.exceptions.length);
    expect(Math.min(...lengths)).toBeGreaterThan(0);
  });

  it("accounts for every row across the four incantation families", () => {
    const commands = ESCAPE_HATCHES.filter((hatch) => hatch.key.kind === "command").length;
    const grants = ESCAPE_HATCHES.filter((hatch) => hatch.key.kind === "grant").length;
    expect(REGISTERED_ENV_VARIABLES.length + REGISTERED_DOOR_TOKENS.length + commands + grants).toBe(
      ESCAPE_HATCHES.length,
    );
  });

  it("gives no journalled row a variable, so a journalled hatch opens on a grant and nothing else", () => {
    const rows: readonly EscapeHatch[] = ESCAPE_HATCHES;
    const journalledEnv = rows.filter((hatch) => hatch.lane === "journalled" && hatch.key.kind === "env");
    expect(ESCAPE_HATCHES.filter((hatch) => hatch.key.kind === "grant").length).toBeGreaterThan(0);
    expect(journalledEnv.map((hatch) => hatch.id)).toEqual([]);
  });

  it("spells an AMBIENT env hatch as SLOPWEAVER_ALLOW_<SUFFIX>=1", () => {
    expect(hatchIncantation({ hatch: hatchFor({ id: "dirty-tree" }) })).toBe("SLOPWEAVER_ALLOW_DIRTY_TREE=1");
  });

  it("spells an ambient door hatch as the door's own comma-list variable", () => {
    expect(
      hatchIncantation({
        hatch: {
          caught: "a stub",
          command: "a command",
          exceptions: ["an exception"],
          id: "stub",
          key: { kind: "door-token", token: "stub.warn:v2" },
          lane: "ambient",
          reader: "src/nowhere.ts",
          standing: "proposed",
        },
      }),
    ).toBe("SLOPWEAVER_DOOR_OVERRIDE=stub.warn:v2");
  });

  it("spells a JOURNALLED hatch as the grant verb, never as its key", () => {
    const said = hatchIncantation({ hatch: hatchFor({ id: "skill-load" }) });
    expect(said).toBe(
      'slopweaver hatch open skill-load --reason "<why this one is a legitimate exception>", then re-run',
    );
  });

  it("spells an ambient env hatch OUTSIDE the family by its own full name, ALLOW_FABLE_OVERRIDE", () => {
    expect(hatchIncantation({ hatch: hatchFor({ id: "fable-worker" }) })).toBe("ALLOW_FABLE_OVERRIDE=1");
    expect(hatchFor({ id: "fable-worker" }).reader).toBe("src/cmux/modelPin.ts");
  });

  it("spells the responder break-glass as the grant verb, never the variable it used to be", () => {
    const hatch = hatchFor({ id: "responder-allow-open" });
    expect(hatch.key).toEqual({ kind: "grant" });
    expect(hatchIncantation({ hatch })).toBe(
      'slopweaver hatch open responder-allow-open --reason "<why this one is a legitimate exception>", then re-run',
    );
  });

  it("builds the full variable name from a suffix", () => {
    expect(hatchEnvVar({ suffix: "POLL" })).toBe("SLOPWEAVER_ALLOW_POLL");
  });

  it("names the module that reads each hatch", () => {
    expect(hatchFor({ id: "poll" }).reader).toBe("src/admit/pollGate.ts");
  });

  it("throws rather than answering undefined for an id nothing declares", () => {
    // @ts-expect-error — the type refuses this id; the throw is the runtime backstop behind it.
    expect(() => hatchFor({ id: "not-a-hatch" })).toThrow('escape-hatch register has no row for "not-a-hatch"');
  });
});

describe("what the owner's ruling settled", () => {
  it("names every row still awaiting the owner's word, so a proposal cannot arrive unnoticed", () => {
    // Widened to `string` on purpose: comparing the literal union against "proposed" is a check TypeScript
    // proves can never fail, which reports clean forever.
    //
    // This is the LIST of unsettled ids rather than the absence of any, which keeps the force: a row added
    // as a proposal still fails this until someone writes it down here, so nothing arrives invisibly. It does
    // not pressure the next session to mark a row `ruled` to get green, which would put words in the
    // owner's mouth, the exact failure the standing axis exists to prevent.
    const proposed = ESCAPE_HATCHES.filter((hatch): boolean => hatch.standing === "proposed").map(
      (hatch): string => hatch.id,
    );
    // Each row below is one whose rule or exceptions are a session's proposal: either the rule itself is the
    // owner's word and only the exception list is proposed, or the whole row is a fleet finding.
    expect(proposed).toEqual([
      "anchor-attribution",
      "proof-witness",
      "stale-seat-finding",
      "animated-gif",
      "unread-image",
      "invalid-datadog-console-host",
      "repeat-send",
      "repeat-thread-reply",
      "responder-allow-open",
      "high-stakes-undefended",
      "high-stakes-second-post",
      "channel-steered-draft",
      "answer-first",
      "vulnerability-fix-topup-gate",
      "stack-adopt-register-only",
      "restore-overwrites-storage",
      "freeze-opens-new-history",
      "unobserved-required-context",
      "private-terms-unchecked",
      "unseen-review-threads",
      "off-seat-lap",
      "earns-its-place",
      "redundant-quote",
      "digest-before-topup",
      "retired-linear-team",
      "stale-snapshot",
      "session-subagent",
      "python",
      "adc-signin",
      "raw-bash",
      "artifact",
      "page-external-local-asset",
      "unreviewed-page",
      "memory-write",
      "relay-words",
      "memory-corpus",
      "datadog-site",
      "browser-page-read-only",
      "browser-blind-keystroke",
      "browser-raw-selector",
      "browser-offscreen-target",
      "codex-browser-door",
      "browser-launch",
      "codex-electron-guard",
      "codex-scratch-shell-guard",
      "protected-path",
      "protect-remove",
      "proof-path",
      "proof-output-in-tree",
      "slow-cassette",
      "page-lint",
      "pr-evidence-loss",
      "old-history-push",
      "uncovered-outcome",
      "undispatched-load",
      "idle-capacity",
      "unseated-recipe-failure",
      "unread-voice-words",
      "unpicked-steers",
      "approved-draft-held",
      "unseated-stopped-recipes",
      "no-work-claim",
      "unescalated-steer-risk",
      "unescalated-fleet-health",
      "talk-file-credential",
      "unread-mark-adopt",
      "non-owner-console-live-talk",
      "call-state-delete",
      "intake-witness-reuse",
      "off-fable-chair",
      "metered-chair",
      "unrouted-seat",
      "unread-owner-turns",
      "fable-worker",
      "unread-checks",
      "uncarded-page",
      "park-running-seat",
      "park-standing-session",
      "park-own-landing",
      "unaligned-card",
      "later-owner-words",
      "held-question-owner-words",
      "fleet-sign-in-card",
      "unheld-draft",
      "undrawn-draft",
      "undrawn-ask-draft",
      "seat-hand-post",
      "unseen-hand-url",
      "judged-ending-swap",
      "unmerged-check-in",
      "codex-duplicate-pass",
      "fallback-review-uncapped",
      "fallback-plan-uncapped",
      "codex-review-pass-cap",
      "early-codex-reset",
      "atlas-read-unproven-empty",
      "stale-build",
      "unreadable-plan",
      "boot-burst",
      "spawn-backoff",
      "rotation-copy-retired",
      "identity-reenroll",
      "claude-mint-authorize-host",
      "early-claude-reset",
      "atlas-evidence-loss",
      "claude-watch-admission",
      "local-store-elsewhere",
      "stale-store",
      "unlanded-migration",
      "stale-journal-reader",
      "unrooted-brief-path",
      "disk-wide-scan",
      "unbounded-search",
      "home-git-implicit",
      "whole-tree-check",
      "run-due-deadline",
      "review-after-clean",
      "review-thread-delta",
      "datadog-monitor-iac-managed",
      "gcp-edit-existing",
    ]);
  });

  it("registers the keep-alive's start-up refusal as the one command that queues instead, with no env var", () => {
    const hatch = hatchFor({ id: "claude-watch-admission" });
    expect(hatch.key).toEqual({ incantation: "slopweaver claude watch --wait", kind: "command" });
    expect(hatch.lane).toBe("ambient");
    expect(hatch.reader).toBe("src/cli/commands/claude/watchAdmission.ts");
    expect(hatchRefusal({ detail: "already running: pid 5151 from /wt/main", hatch }).split("\n")[2]).toBe(
      "To override use the designated escape hatch slopweaver claude watch --wait.",
    );
  });

  it("registers the deliberate re-enroll as the one flag that performs it, with no env var beside it", () => {
    const hatch = hatchFor({ id: "identity-reenroll" });
    expect(hatch.key).toEqual({ incantation: "slopweaver claude signin --reenroll <alias,...>", kind: "command" });
    expect(hatch.lane).toBe("ambient");
    expect(hatch.reader).toBe("src/cli/commands/claude/signinRun.ts");
  });

  it("gives the bump gate the hatch it had none of, in the journalled lane", () => {
    const hatch = hatchFor({ id: "untagged-bump" });
    expect(hatch.lane).toBe("journalled");
    expect(hatch.key).toEqual({ kind: "grant" });
  });

  it("puts every outbound row in the journalled lane, and nothing else", () => {
    const journalled = ESCAPE_HATCHES.filter((hatch) => hatch.lane === "journalled").map((hatch) => hatch.id);
    // The count moves only with a row that is outbound: `channel-steered-draft` sends a held draft into a channel
    // the owner moved it away from, `retired-linear-team` files into a team the owner left,
    // `responder-allow-open` admits an unlisted person to drive the bot and receive its replies, and
    // `voice-briefing` lets a session that never read the owner's voice brief draft or send words in their name.
    expect(journalled.length).toBe(42);
    expect(journalled).toContain("voice-briefing");
    expect(journalled).toContain("responder-allow-open");
    expect(journalled).toContain("wall");
    expect(journalled).toContain("channel-steered-draft");
    // A draft parked past the earns-its-place caps is a message to a person once the owner releases it.
    expect(journalled).toContain("earns-its-place");
    // A repeat is refused on every Slack post, each of which reaches a person or a team.
    expect(journalled).toContain("repeat-send");
    // A repeat thread reply lands in a reviewer's thread, so the audience is a person.
    expect(journalled).toContain("repeat-thread-reply");
    // Both high-stakes rows waive a top-level post into a channel many people watch, so the audience is a room.
    expect(journalled).toContain("high-stakes-undefended");
    expect(journalled).toContain("high-stakes-second-post");
    // A graph finding sent short of its screenshots is waived on a Slack answer, so the audience is a person.
    expect(journalled).toContain("unshown-graphs");
    // A blind spot declining a readable atlas is waived on a Slack answer, so the audience is a person and
    // it joins by the same criterion rather than a second ruling.
    expect(journalled).toContain("declined-atlas");
    // Same criterion again: a Datadog citation that does not open on its claim's evidence is waived on a
    // Slack answer, so the audience is a person.
    expect(journalled).toContain("datadog-citation");
    // A dead Datadog host is refused on every provider write, each of which reaches a person or a team.
    expect(journalled).toContain("invalid-datadog-console-host");
    // The document-deliverable rows join by the same criterion: both waive something about a bot ANSWER
    // posted into a Slack thread, so the audience is a person.
    expect(journalled).toContain("local-page-path");
    expect(journalled).toContain("markdown-first");
    // `digest-before-topup` waives a Slack post into a team channel, so its audience is a person and it
    // joins this lane by the same criterion as the image rows, not by a second ruling.
    expect(journalled).toContain("digest-before-topup");
    // The image rows: attaching an image is an outbound act, so both its exceptions are journalled like the
    // rest, one for a picture nobody recorded, one for a reviewer's verdict that does not cover every
    // picture the send carries.
    expect(journalled).toContain("unread-image");
    expect(journalled).toContain("answer-image-observations");
    // An animated GIF is waived on an attachment that lands in a pull request a reviewer reads, so the audience
    // is a person and it joins by the same criterion as `invented-visual`.
    expect(journalled).toContain("animated-gif");
    // Dropping evidence from a pull request description is waived on a write a reviewer reads, so the audience
    // is a person; `pr-replace`, which consents to the wholesale write itself, stays ambient.
    expect(journalled).toContain("pr-evidence-loss");
    expect(journalled).not.toContain("pr-replace");
    expect(journalled).not.toContain("card-framing");
    expect(journalled).not.toContain("poll");
  });

  it("registers the merge guard's hatch as the flag that already worked, not a second env var", () => {
    expect(hatchIncantation({ hatch: hatchFor({ id: "reverts-main" }) })).toBe(
      "slopweaver github merge --acknowledge <path>",
    );
  });
});
