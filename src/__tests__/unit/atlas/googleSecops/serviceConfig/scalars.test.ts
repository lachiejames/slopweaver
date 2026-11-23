/**
 * How `parseChronicleServiceConfig` refuses a value YAML readers fold differently: a stray quote, a file with no
 * final newline, a block scalar headed anything but a bare `|-`, or a flow collection.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses a quote outside one value quoted and closed on its own line, wherever it sits", () => {
    // The attack: a value ending in an escaped quote stays open, and the under-indented `#` lines after it are a
    // comment to libyaml but a real auth rule to this reader once the lexer cuts the value short.
    const scopes = "      canonical_scopes: |-";
    const attack =
      "      canonical_scopes: 'https://www.googleapis.com/auth/cloud-platform,''\n  #\n  - selector: x\n  #";
    const attackText = CONFIG.replace(scopes, attack);
    const body = "    body: '*'";
    const singles = [
      { count: 3, text: attackText, start: CONFIG.indexOf(scopes) },
      { count: 4, text: CONFIG.replace(body, "    body: 'a''b'"), start: CONFIG.indexOf(body) },
      { count: 2, text: CONFIG.replace(body, "    body: ''"), start: CONFIG.indexOf(body) },
      {
        count: 2,
        text: CONFIG.replace("api_short_name: chronicle", "api_short_name: chron''icle"),
        start: CONFIG.indexOf("  api_short_name"),
      },
      { count: 4, text: CONFIG.replace(body, "    body: '*' # 'c'"), start: CONFIG.indexOf(body) },
      { count: 1, text: CONFIG.replace(body, "    body: '*"), start: CONFIG.indexOf(body) },
      { count: 1, text: `'${CONFIG}`, start: 0 },
    ];
    const doubles = [
      { offset: 0, text: `"${CONFIG}` },
      { offset: CONFIG.indexOf(body) + "    body: ".length, text: CONFIG.replace(body, '    body: "*"') },
    ];
    expect(singles.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      singles.map(({ count, start }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds ${count} single quotes on the line at offset ${start}, where only one value quoted and closed on that line is read — an open quote folds the next lines into one value for libyaml and not for this reader`,
        }),
      ),
    );
    expect(doubles.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      doubles.map(({ offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds '"' at offset ${offset}, which opens a double-quoted value that YAML readers fold across lines differently`,
        }),
      ),
    );
  });

  it("refuses a file that stops short of a final newline, where a closing block scalar reads one byte longer", () => {
    // The attack: the http block moved last, a path written as a `|` block scalar, the final newline dropped —
    // this reader would bind the path with a trailing newline that libyaml does not read.
    const http = CONFIG.slice(CONFIG.indexOf("http:\n"), CONFIG.indexOf("\nauthentication:"));
    const listRule = "  - selector: google.longrunning.Operations.ListOperations\n    get: |\n      /v1/x";
    const attack = `${CONFIG.replace(http, "")}${http}${listRule}`;
    const texts = [attack, CONFIG.slice(0, -1), ""];
    expect(attack.endsWith("      /v1/x")).toBe(true);
    expect(texts.map((text) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      texts.map((text) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `ends at offset ${text.length} without a newline, where a block scalar closing the file reads a trailing newline here and none in libyaml`,
        }),
      ),
    );
  });

  it("refuses a block scalar headed anything but a bare |-, wherever it sits", () => {
    // The attack: an indentation indicator below the path's own indent, then a line of exactly that many spaces —
    // libyaml keeps it as a trailing newline and space on the path, this reader drops it.
    const get = "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'";
    const getOffset = CONFIG.indexOf(get) + "    get: ".length;
    const scopes = "      canonical_scopes: |-";
    const scopesOffset = CONFIG.indexOf(scopes) + "      canonical_scopes: ".length;
    // Not only a mapping value: a block scalar as an explicit key and as a list item is refused the same way.
    const publishingOffset = CONFIG.indexOf("publishing:");
    const asKey = CONFIG.replace("publishing:", "? |1-\n zzz\n \n: 1\npublishing:");
    const asItem = CONFIG.replace("publishing:", "extra:\n- |1-\n  zzz\n  \npublishing:");
    const cases = [
      { header: "|1-", offset: getOffset, text: CONFIG.replace(get, "    get: |1-\n      /v1/x\n      ") },
      { header: "|", offset: getOffset, text: CONFIG.replace(get, "    get: |\n      /v1/x") },
      { header: ">-", offset: scopesOffset, text: CONFIG.replace(scopes, "      canonical_scopes: >-") },
      { header: "|+", offset: scopesOffset, text: CONFIG.replace(scopes, "      canonical_scopes: |+") },
      { header: "|- # c", offset: scopesOffset, text: CONFIG.replace(scopes, "      canonical_scopes: |- # c") },
      { header: "|1-", offset: publishingOffset + "? ".length, text: asKey },
      { header: "|1-", offset: publishingOffset + "extra:\n- ".length, text: asItem },
    ];
    expect(cases.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      cases.map(({ header, offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds a block scalar headed '${header}' at offset ${offset}, where only a bare |- is read — any other header splits readers on its trailing lines`,
        }),
      ),
    );
  });

  it("refuses a flow collection holding anything, where YAML readers split its keys differently", () => {
    // libyaml reads `?rules` as a second `rules` list granting the readonly scope; this reader keeps `?rules`.
    const flowAuthentication =
      "authentication: {rules: [], ?rules: [{selector: 'google.cloud.chronicle.v1.RuleService.*', oauth: {canonical_scopes: x}}]}\nunread:\n";
    const cases = [
      {
        offset: CONFIG.indexOf("authentication:") + "authentication: ".length,
        text: CONFIG.replace("authentication:\n", flowAuthentication),
      },
      {
        offset: CONFIG.indexOf("publishing:") + "publishing: ".length,
        text: CONFIG.replace("publishing:\n  api_short_name: chronicle\n", "publishing: {api_short_name: chronicle}\n"),
      },
      {
        offset: CONFIG.indexOf("api_short_name: chronicle") + "api_short_name: ".length,
        text: CONFIG.replace("api_short_name: chronicle", "api_short_name: [chronicle]"),
      },
    ];
    expect(cases.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      cases.map(({ offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds a flow collection at offset ${offset}, whose keys YAML readers split differently — write it as a block`,
        }),
      ),
    );
  });
});
