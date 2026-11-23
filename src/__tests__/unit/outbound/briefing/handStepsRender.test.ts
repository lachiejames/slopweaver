import { describe, expect, it } from "vitest";

import { LITERAL_CAP } from "../../../../hand/stepAddress.js";
import { BRIEFING_CHROME } from "../../../../outbound/briefing/chrome.js";
import { renderHandSteps } from "../../../../outbound/briefing/handStepsRender.js";
import { handStepsSchema } from "../../../../outbound/briefing/handStepsSchema.js";
import { type BriefingHandStepRow, HAND_STEPS_ID } from "../../../../outbound/briefing/types.js";

/** One projected row, varying only what a test cares about. */
function row(over: Partial<BriefingHandStepRow> = {}): BriefingHandStepRow {
  return {
    id: "trelica-signin",
    postedIso: "2026-09-19T18:25:44.275Z",
    tier: "fleet-blocked",
    unblocks: "every scheduled Trelica resync",
    what: "Sign in to Trelica in Chrome",
    witness: "slopweaver hand done trelica-signin",
    ...over,
  };
}

/** The whole section, as one string, which is what a reader's browser actually receives. */
function html({
  rows,
  notShown = 0,
  unreadable = 0,
}: {
  rows: readonly BriefingHandStepRow[];
  notShown?: number;
  unreadable?: number;
}): string {
  return renderHandSteps({ handSteps: { notShown, rows, unreadable } }).join("\n");
}

describe("renderHandSteps", () => {
  it("marks a check-in as one beside its id, and no other step", () => {
    const page = html({ rows: [row({ id: "try-now-page", tier: "check-in" }), row({ id: "owners-885" })] });
    expect(page).toContain('<code>try-now-page</code></span> <span class="bg">check-in</span></p>');
    expect(page).toContain("<code>owners-885</code></span></p>");
  });

  it("renders nothing at all when no step is open", () => {
    expect(renderHandSteps({ handSteps: { notShown: 0, rows: [], unreadable: 0 } })).toEqual([]);
  });

  it("still puts a heading on the page when every register line went unread", () => {
    // "nothing is waiting on you" and "the register could not be read" are different claims, and rendering
    // the first for the second is the confident wrong answer this whole feature landed to stop.
    const page = html({ rows: [], unreadable: 1 });
    expect(page).toContain(`<h2 id="${HAND_STEPS_ID}">waiting on your hands</h2>`);
    expect(page).toContain(
      "1 register line(s) could not be read, so a step may be open that is not here — " +
        "`slopweaver hand list` names every one of them",
    );
  });

  it("says nothing about unread lines when the register read whole", () => {
    expect(html({ rows: [row()] }).includes("could not be read")).toBe(false);
  });

  it("draws a checklist as numbered lines, each command its own paste block and each value's place named", () => {
    const checklist = [
      { action: "Open the Credentials page", url: "https://console.cloud.google.com/apis/credentials" },
      {
        action: "Paste the Client ID when it asks",
        command: "slopweaver secrets set google-secops-client-id",
        find: ["Additional information", "Client ID"],
      },
      {
        action: "Paste the Client secret when it asks",
        command: "slopweaver secrets set google-secops-client-secret",
        find: ["Client secrets", "Client secret"],
      },
    ];
    const page = html({ rows: [row({ checklist, id: "secops-client" })] });
    expect(page.split('<button class="paste-copy" type="button">copy</button>').length - 1).toBe(2);
    expect(page).toContain("<pre>slopweaver secrets set google-secops-client-id</pre>");
    expect(page).toContain("<pre>slopweaver secrets set google-secops-client-secret</pre>");
    expect(page).toContain('<span class="bg">Find it under: Additional information › Client ID</span>');
    expect(page).toContain(
      '<li>Open the Credentials page <a href="https://console.cloud.google.com/apis/credentials">',
    );
    expect(handStepsSchema.safeParse({ notShown: 0, rows: [row({ checklist })], unreadable: 0 }).success).toBe(true);
  });

  it("puts the command in a paste block the chrome's own copy listener can serve", () => {
    const page = html({ rows: [row({ literal: "gcloud auth application-default login" })] });
    expect(page).toContain('<div class="paste"><div class="paste-head">');
    expect(page).toContain('<button class="paste-copy" type="button">copy</button>');
    expect(page).toContain("<pre>gcloud auth application-default login</pre>");
    // The chrome's delegated listener finds the `<pre>` inside the same `.paste` element. If either half
    // of that contract moved, the copy button on this section would silently stop working.
    expect(BRIEFING_CHROME).toContain("paste-copy");
    expect(BRIEFING_CHROME).toContain(".paste");
  });

  it("draws NO paste block on a step with no command — there is nothing to copy", () => {
    const page = html({ rows: [row({ where: "the Trelica admin console" })] });
    expect(page.includes('class="paste"')).toBe(false);
    expect(page).toContain("<strong>Where:</strong> the Trelica admin console");
    // The settling verb is `code`, never a second copy button beside the real one.
    expect(page).toContain("<strong>Settles with:</strong> <code>slopweaver hand done trelica-signin</code>");
  });

  it("escapes a command carrying HTML, so no step can add markup to the page", () => {
    // A `</pre>` inside a command is the one that matters here: unescaped it would close the block early
    // and let the rest of the step's own bytes render as page markup.
    const page = html({ rows: [row({ literal: 'echo "</pre><script>x</script>"' })] });
    expect(page).toContain('<pre>echo "&lt;/pre&gt;&lt;script&gt;x&lt;/script&gt;"</pre>');
    expect(page.includes("<script>")).toBe(false);
    expect(page.includes("</pre><script>")).toBe(false);
  });

  it("puts the step's own line OUTSIDE the fold, where the page budget can see it", () => {
    const page = html({ rows: [row()] });
    const line = page.indexOf('<p class="q">Sign in to Trelica in Chrome');
    const fold = page.indexOf("<details>");
    expect(line).toBeGreaterThan(0);
    expect(fold).toBeGreaterThan(line);
    expect(page).toContain(`<h2 id="${HAND_STEPS_ID}">waiting on your hands</h2>`);
    expect(page).toContain('<div class="step">');
  });

  it("says how many steps it is not showing rather than implying it showed them all", () => {
    const page = html({ notShown: 4, rows: [row()] });
    expect(page).toContain("4 more step(s) not shown — `slopweaver hand list` has all of them");
  });

  it("stays silent about a remainder there is none of", () => {
    expect(html({ rows: [row()] }).includes("not shown")).toBe(false);
  });

  it("renders a link when the step named a page to open", () => {
    const page = html({ rows: [row({ url: "https://app.trelica.com/admin" })] });
    expect(page).toContain('<a href="https://app.trelica.com/admin">https://app.trelica.com/admin</a>');
  });
});

describe("handStepsSchema", () => {
  it("accepts the section the projection produces", () => {
    const parsed = handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ literal: "echo hi" })] });
    expect(parsed.success).toBe(true);
  });

  it("accepts a newer blocker ahead of an older check-in, because that is the ranking", () => {
    const parsed = handStepsSchema.safeParse({
      notShown: 0,
      unreadable: 0,
      rows: [row({ id: "newer", postedIso: "2026-09-20T14:51:08.996Z" }), row({ id: "older", tier: "check-in" })],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a check-in ahead of a blocker, because a check-in never leads", () => {
    const parsed = handStepsSchema.safeParse({
      notShown: 0,
      unreadable: 0,
      rows: [row({ id: "older", tier: "check-in" }), row({ id: "newer", postedIso: "2026-09-20T14:51:08.996Z" })],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("not ranked");
  });

  it("refuses rows of one tier that are not oldest first, because that means something re-sorted them", () => {
    const parsed = handStepsSchema.safeParse({
      notShown: 0,
      unreadable: 0,
      rows: [row({ id: "newer", postedIso: "2026-09-20T14:51:08.996Z" }), row({ id: "older" })],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("oldest first within a tier");
  });

  it("refuses two rows carrying the same step id", () => {
    const parsed = handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row(), row()] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("could not say which one it settles");
  });

  it("refuses a key nobody declared, so an invented field is never dropped silently", () => {
    const parsed = handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [{ ...row(), urgency: "high" }] });
    expect(parsed.success).toBe(false);
  });

  it("refuses a `postedIso` no clock can parse", () => {
    const parsed = handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ postedIso: "yesterday" })] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("ISO-8601");
  });

  it("accepts a multi-line command, which the page's prose rules would have refused", () => {
    // `literal` is bytes the owner pastes, so it is NOT a `proseLine` — a numbered set of lines in a shell script
    // is a script, not the packed enumeration that rule exists to refuse.
    const script = "1. gcloud auth login\n2. gcloud config set project x\n3. gcloud storage ls";
    expect(handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ literal: script })] }).success).toBe(
      true,
    );
    expect(handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ what: script })] }).success).toBe(
      false,
    );
  });

  it("refuses a `what` that trails off, because a cut leaves it nowhere on the page to read", () => {
    const parsed = handStepsSchema.safeParse({
      notShown: 0,
      unreadable: 0,
      rows: [row({ what: "Sign in to Trelica and…" })],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("ellipsis");
  });

  it("accepts a command the register accepts, right up to its own cap", () => {
    // The page's bound IS the register's (`LITERAL_CAP`), so a step `hand post` took cannot fail to reach
    // the page — a silent hole exactly where the owner is waiting for a command.
    const atCap = "x".repeat(LITERAL_CAP);
    expect(handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ literal: atCap })] }).success).toBe(
      true,
    );
    expect(
      handStepsSchema.safeParse({ notShown: 0, unreadable: 0, rows: [row({ literal: `${atCap}x` })] }).success,
    ).toBe(false);
  });
});
