import { describe, expect, it } from "vitest";
import {
  decideBehaviouralProbe,
  decideLint,
  decideMainCheckoutEntry,
} from "../../../../../cli/commands/handover/lintRun.js";

const SOUND = `---
slug: sound
artifact: https://claude.ai/code/artifact/aaaa
status: ready
---
`;

const MISSING_ARTIFACT = `---
slug: missing
status: ready
repo: /repo
---
`;

const DUPLICATE_KEY = `---
slug: dup
status: ready
status: draft
---
`;

describe("decideLint", () => {
  it("reports a doc that already declares artifact: as sound, with nothing to write", () => {
    const outcome = decideLint({ fix: false, path: "/board/sound.md", text: SOUND });
    expect(outcome.kind).toBe("sound");
    expect(outcome.write).toBeUndefined();
  });

  it("reports a missing artifact as needsFix without --fix, and does not compute a write", () => {
    const outcome = decideLint({ fix: false, path: "/board/missing.md", text: MISSING_ARTIFACT });
    expect(outcome.kind).toBe("needsFix");
    expect(outcome.write).toBeUndefined();
  });

  it("computes the fixed text when --fix is passed, without writing it anywhere", () => {
    const outcome = decideLint({ fix: true, path: "/board/missing.md", text: MISSING_ARTIFACT });
    expect(outcome.kind).toBe("fixed");
    expect(outcome.write).toContain("\nartifact: null\n");
  });

  it("refuses a doc with a genuine parse problem even when --fix is passed", () => {
    const outcome = decideLint({ fix: true, path: "/board/dup.md", text: DUPLICATE_KEY });
    expect(outcome.kind).toBe("refused");
    expect(outcome.write).toBeUndefined();
    expect(outcome.detail).toContain('declares "status" more than once');
  });
});

const OWNER_ASK_DONE = `---
slug: owner-ask-done
artifact: https://claude.ai/code/artifact/aaaa
status: done
summary: "OWNER ASK: the supervisor blocked on the owner's keypress"
doneWhen:
  - present: "skills/supervisor/SKILL.md#never blocks on"
---
`;

const OWNER_ASK_IN_PROGRESS = OWNER_ASK_DONE.replace("status: done", "status: in-progress");

const OWNER_ASK_DONE_BEHAVIOURAL = `---
slug: owner-ask-probed
artifact: https://claude.ai/code/artifact/aaaa
status: done
summary: "OWNER ASK: the supervisor blocked on the owner's keypress"
doneWhen:
  - command: "slopweaver supervisor sweep --dry-run | grep -q 'never blocks'"
---
`;

const NO_MARKER_DONE = `---
slug: no-marker
artifact: https://claude.ai/code/artifact/aaaa
status: done
summary: "the repo owner is the sole CODEOWNER, so a plain merge is refused"
doneWhen:
  - present: "src/a.ts#runMerge"
---
`;

describe("decideBehaviouralProbe", () => {
  it("refuses a done owner-ask doc whose only probe is structural, and offers no write", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/owner-ask-done.md",
      structuralAllowed: false,
      text: OWNER_ASK_DONE,
    });

    expect(outcome!.kind).toBe("unprobed");
    expect(outcome!.write).toBeUndefined();
    expect(outcome!.detail!).toContain('records an owner ask ("owner ask")');
  });

  /**
   * The transition is what the owner ruled on, not the doc. A doc still in flight has not claimed anything
   * yet — `handover finish` is what asks it the same question at the moment it closes.
   */
  it("leaves the same doc alone while it is still in-progress", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/wip.md",
      structuralAllowed: false,
      text: OWNER_ASK_IN_PROGRESS,
    });

    expect(outcome).toBeUndefined();
  });

  it("passes a done owner-ask doc that declares a behavioural probe", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/probed.md",
      structuralAllowed: false,
      text: OWNER_ASK_DONE_BEHAVIOURAL,
    });

    expect(outcome).toBeUndefined();
  });

  /** The break-glass, threaded from the CLI edge — without this pair the gate could refuse unconditionally. */
  it("stands down entirely under the break-glass, on the doc it would otherwise refuse", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/owner-ask-done.md",
      structuralAllowed: true,
      text: OWNER_ASK_DONE,
    });

    expect(outcome).toBeUndefined();
  });

  /**
   * The mode the owner has not settled yet. `advise` must print the SAME finding and only change whether it
   * fails the run — a second, differently-worded message would be a second rule.
   */
  it("reports the same doc as advisory, not unprobed, when the mode is advise", () => {
    const outcome = decideBehaviouralProbe({
      mode: "advise",
      path: "/board/owner-ask-done.md",
      structuralAllowed: false,
      text: OWNER_ASK_DONE,
    });

    expect(outcome!.kind).toBe("advisory");
    expect(outcome!.detail!).toContain('records an owner ask ("owner ask")');
    expect(outcome!.detail!).toContain("advisory only");
  });

  it("finds a done doc with no owner-ask marker, and names the claim rather than a phrase", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/no-marker.md",
      structuralAllowed: false,
      text: NO_MARKER_DONE,
    });

    expect(outcome!.kind).toBe("unprobed");
    expect(outcome!.detail!).toContain("declares no probe that would fail if its claim were false");
    expect(outcome!.detail!).toContain("- present: src/a.ts#runMerge");
  });
});

const OWNER_ASK_DONE_WAIVED = OWNER_ASK_DONE.replace(
  "status: done",
  'status: done\nprobeWaiver: "landed on the private work repo; no probe runnable from this checkout"',
);

describe("decideBehaviouralProbe with a recorded waiver", () => {
  /**
   * The owner's hatch: reported, never silent, and never failing the run. A waived doc that vanished from the
   * output would be exactly the invisible `done` this rule exists to end.
   */
  it("reports a waived doc as advisory, naming the reason, and does not fail the run", () => {
    const outcome = decideBehaviouralProbe({
      mode: "refuse",
      path: "/board/waived.md",
      structuralAllowed: false,
      text: OWNER_ASK_DONE_WAIVED,
    });

    expect(outcome!.kind).toBe("advisory");
    expect(outcome!.detail!).toContain("WAIVED");
    // The flat front-matter reader keeps a quoted scalar's quotes, exactly as it does for `summary:` — so
    // this asserts what a reader actually sees, not a tidier string nothing prints.
    expect(outcome!.detail!).toContain("probeWaiver: landed on the private work repo");
  });
});

describe("decideMainCheckoutEntry", () => {
  const DECLARED = ["/fixture-root/dev/work-repo"];
  const ENTERS = "---\nslug: enters\n---\n\n```bash\ncd ~/dev/work-repo && yarn evidence\n```\n";

  it("refuses a doc whose fenced command enters a declared main checkout", () => {
    expect(
      decideMainCheckoutEntry({ declared: DECLARED, home: "/fixture-root", path: "/board/a.md", text: ENTERS })!.kind,
    ).toBe("entersMainCheckout");
  });

  it("names the offending line in the detail, so the author can find it", () => {
    expect(
      decideMainCheckoutEntry({ declared: DECLARED, home: "/fixture-root", path: "/board/a.md", text: ENTERS })!.detail,
    ).toContain("line 6");
  });

  it("never proposes a write, because the repair is a judgement --fix cannot make", () => {
    expect(
      decideMainCheckoutEntry({ declared: DECLARED, home: "/fixture-root", path: "/board/a.md", text: ENTERS })!.write,
    ).toBeUndefined();
  });

  it("passes a doc that sends its reader into a worktree instead", () => {
    expect(
      decideMainCheckoutEntry({
        declared: DECLARED,
        home: "/fixture-root",
        path: "/board/a.md",
        text: "---\nslug: ok\n---\n\n```bash\ncd ~/dev/work-repo/.claude/worktrees/mine\n```\n",
      }),
    ).toBeUndefined();
  });

  it("applies at every status, not only at done", () => {
    expect(
      decideMainCheckoutEntry({
        declared: DECLARED,
        home: "/fixture-root",
        path: "/board/a.md",
        text: ENTERS.replace("slug: enters", "slug: enters\nstatus: ready"),
      })!.kind,
    ).toBe("entersMainCheckout");
  });

  it("passes every doc when nothing is declared", () => {
    expect(
      decideMainCheckoutEntry({ declared: [], home: "/fixture-root", path: "/board/a.md", text: ENTERS }),
    ).toBeUndefined();
  });
});
