/**
 * A typed command error prints one line per problem, exactly as the `readonly string[]` it replaced did.
 *
 * Each union joins a list-carrying variant into one `message` for a single-line display, and the line helper
 * is what keeps a consumer that printed problems one per line from collapsing them into that join.
 */
import { describe, expect, it } from "vitest";
import { RecipeCommandErrors, recipeCommandErrorLines } from "../../../cli/commands/automation/errors.js";
import { CodexCommandErrors, codexCommandErrorLines } from "../../../cli/commands/codex/errors.js";
import { NotionCommandErrors, notionCommandErrorLines } from "../../../cli/commands/notion/errors.js";
import { ProviderReadArgsErrors, providerReadArgsErrorLines } from "../../../cli/commands/providerRead/errors.js";
import { RouteCommandErrors, routeCommandErrorLines } from "../../../cli/commands/route/errors.js";
import { SessionStartErrors, sessionStartErrorLines } from "../../../cli/commands/sessionStart/errors.js";
import { RecipeSlotAttemptErrors } from "../../../live/automation/slotAttemptErrors.js";

const TWO = ["unknown flag: --a", "unknown flag: --b"];

describe("codexCommandErrorLines", () => {
  it("gives each invalid properties entry its own line", () => {
    expect(codexCommandErrorLines({ error: CodexCommandErrors.propertiesEntriesInvalid({ reasons: TWO }) })).toEqual(
      TWO,
    );
  });

  it("gives a single-message variant its message", () => {
    expect(codexCommandErrorLines({ error: CodexCommandErrors.propertiesNotObject() })).toEqual([
      "the properties file must contain a JSON object",
    ]);
  });
});

describe("notionCommandErrorLines", () => {
  it("gives each tokeniser reason its own line", () => {
    expect(notionCommandErrorLines({ error: NotionCommandErrors.flagsInvalid({ reasons: TWO }) })).toEqual(TWO);
  });

  it("gives each refused argument its own line", () => {
    expect(notionCommandErrorLines({ error: NotionCommandErrors.argsRefused({ reasons: TWO }) })).toEqual(TWO);
  });

  it("gives a single-message variant its message", () => {
    expect(notionCommandErrorLines({ error: NotionCommandErrors.tooManyAddresses({ count: 2 }) })).toEqual([
      "notion verify checks ONE page; pass a single address",
    ]);
  });
});

describe("providerReadArgsErrorLines", () => {
  it("gives each tokeniser reason its own line", () => {
    expect(providerReadArgsErrorLines({ error: ProviderReadArgsErrors.flagsInvalid({ reasons: TWO }) })).toEqual(TWO);
  });

  it("gives a single-message variant its message", () => {
    expect(providerReadArgsErrorLines({ error: ProviderReadArgsErrors.afterOnDatabase() })).toEqual([
      "--after applies to a page's top-level blocks; a database read does not list block children",
    ]);
  });
});

describe("sessionStartErrorLines", () => {
  it("gives each lock-in refusal its own line", () => {
    const refusals = [
      SessionStartErrors.topNotPositive({ got: "0" }),
      SessionStartErrors.vocabularyFlagMissing({ allowed: ["a", "b"], flag: "--kind" }),
    ];

    expect(sessionStartErrorLines({ error: SessionStartErrors.lockInRefused({ refusals }) })).toEqual([
      "--top must be a whole number of at least 1, got 0",
      "--kind is required — one of a, b",
    ]);
  });

  it("gives each incoherent-outcome reason its own line", () => {
    expect(sessionStartErrorLines({ error: SessionStartErrors.outcomeIncoherent({ reasons: TWO }) })).toEqual(TWO);
  });

  it("gives each unread review state its own line", () => {
    expect(sessionStartErrorLines({ error: SessionStartErrors.reviewStatesUnread({ reasons: TWO }) })).toEqual(TWO);
  });

  it("gives a single-message variant its message", () => {
    expect(sessionStartErrorLines({ error: SessionStartErrors.noMainCheckouts() })).toEqual([
      SessionStartErrors.noMainCheckouts().message,
    ]);
  });
});

describe("recipeCommandErrorLines", () => {
  it("gives each tokeniser reason its own line", () => {
    expect(recipeCommandErrorLines({ error: RecipeCommandErrors.flagsInvalid({ reasons: TWO }) })).toEqual(TWO);
  });

  it("prefixes an unreadable firing record with the verb that read it", () => {
    const cause = RecipeSlotAttemptErrors.notWritten({
      reason: "EACCES",
      recipeId: "r",
      slotIso: "2026-09-01T00:00:00Z",
    });
    expect(recipeCommandErrorLines({ error: RecipeCommandErrors.slotAttemptUnreadable({ cause }) })).toEqual([
      "automation seat · recipe 'r' slot 2026-09-01T00:00:00Z could not be written: EACCES",
    ]);
  });
});

describe("routeCommandErrorLines", () => {
  it("gives each refused profile entry its own line, prefixed with how the verb names the file", () => {
    const error = RouteCommandErrors.profileInvalid({ label: "capability profile", path: "/p.json", problems: TWO });
    expect(routeCommandErrorLines({ error })).toEqual([
      "capability profile /p.json: unknown flag: --a",
      "capability profile /p.json: unknown flag: --b",
    ]);
  });

  it("names an unlabelled file by its path alone", () => {
    expect(
      routeCommandErrorLines({
        error: RouteCommandErrors.fileUnreadable({ detail: "ENOENT", label: null, path: "/f" }),
      }),
    ).toEqual(["could not read /f: ENOENT"]);
    expect(RouteCommandErrors.fileNotJson({ label: "answer", path: "/a" }).message).toBe("answer /a is not valid JSON");
  });

  it("names a sources manifest row by its index", () => {
    expect(RouteCommandErrors.sourceRowInvalid({ index: 2, path: "/m" }).message).toBe(
      'sources manifest /m[2] must be {"label": string, "path": string}',
    );
  });
});
