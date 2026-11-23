/*
 * The text rendering of a page whose verification did not run: each skip reason ends the page on its own footer.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryText,
} from "../../../../../../cli/commands/linear/queryDocument.js";

import { renderedHit } from "./harness.js";

describe("renderLinearQueryText", () => {
  describe("a page whose verification did not run", () => {
    /** A one-hit page skipped for `verifySkipped`, every other value fixed. */
    function skippedDocument({
      verifySkipped,
    }: {
      verifySkipped: NonNullable<LinearQueryDocument["verifySkipped"]>;
    }): LinearQueryDocument {
      return {
        filter: { kind: "issue", text: "needle-onyx" },
        hits: [
          renderedHit({
            assignee: "jon",
            identifier: "OPS-44",
            kind: "issue",
            labels: [],
            project: "Ops",
            state: "Todo",
            title: "Alert routing",
            url: "https://linear.example/ops-44",
          }),
        ],
        matched: 6,
        newestLocalIso: "2026-09-20T10:11:12.000Z",
        readAtIso: "2026-09-21T00:00:00.000Z",
        rowsScanned: 19,
        source: "linear",
        unreadable: [],
        verifySkipped,
      };
    }

    /** Everything above the footer, shared by every skipped page. */
    const BODY = [
      "linear query: kind=issue text=needle-onyx",
      "local: 6 match(es) over 19 bronze row(s); newest local record 2026-09-20T10:11:12.000Z",
      "",
      "  OPS-44  [unchecked]  Alert routing",
      "      Todo · jon · Ops",
      "      https://linear.example/ops-44",
      "",
    ];

    it("says no token is configured, and how to connect one, for `no-token`", () => {
      expect(renderLinearQueryText({ document: skippedDocument({ verifySkipped: "no-token" }) })).toBe(
        [
          ...BODY,
          "citations UNVERIFIED — no Linear token configured; run `slopweaver connect linear` to check them live",
        ].join("\n"),
      );
    });

    it("says --no-verify was passed for `not-requested`", () => {
      expect(renderLinearQueryText({ document: skippedDocument({ verifySkipped: "not-requested" }) })).toBe(
        [...BODY, "citations UNVERIFIED — --no-verify was passed"].join("\n"),
      );
    });

    it("says there was nothing to verify for `no-hits`", () => {
      expect(renderLinearQueryText({ document: skippedDocument({ verifySkipped: "no-hits" }) })).toBe(
        [...BODY, "nothing to verify — the local scan matched no object"].join("\n"),
      );
    });
  });
});
