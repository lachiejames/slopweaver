/**
 * How `parseChronicleServiceConfig` refuses the YAML markers two readers disagree on: a merge key, an unknown
 * tag, an anchor and a directive, each named where it sits.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

/** The detail the marker refusal prints for a character at an offset. */
const markerDetail = ({ character, offset }: { character: string; offset: number }): string =>
  `holds '${character}' at offset ${offset}, which opens a YAML anchor, tag or directive that readers disagree on`;

describe("parseChronicleServiceConfig", () => {
  it("refuses a YAML merge key, naming where it sits", () => {
    const text = CONFIG.replace(
      "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'",
      "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'\n    <<:\n      additional_bindings:\n      - post: '/v1/x'\n        body: '*'",
    );
    expect(unwrapErr(parseChronicleServiceConfig({ text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: "a YAML merge key << at http.rules.0.<< — a 1.1 reader would merge it and this 1.2 reader would not",
      }),
    );
  });

  it("refuses an unknown tag at its marker, before any reader decodes it to a plain string", () => {
    const text = CONFIG.replace("name: chronicle.googleapis.com", "name: !foo chronicle.googleapis.com");
    const offset = CONFIG.indexOf("name: chronicle.googleapis.com") + "name: ".length;
    expect(unwrapErr(parseChronicleServiceConfig({ text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: markerDetail({ character: "!", offset }) }),
    );
  });

  it("refuses an anchor, a tag or a directive, each of which two YAML readers read differently", () => {
    const binding = "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'";
    const cases = [
      {
        offset: CONFIG.indexOf("name: chronicle.googleapis.com") + "name: ".length,
        text: CONFIG.replace("name: chronicle.googleapis.com", "name: &a:b chronicle.googleapis.com"),
      },
      {
        offset: CONFIG.indexOf(binding) + "    ".length,
        text: CONFIG.replace(binding, `    !!merge ${binding.trim()}`),
      },
      { offset: 0, text: `%YAML 1.1\n---\n${CONFIG}` },
    ];
    expect(cases.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual([
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: markerDetail({ character: "&", offset: cases[0]!.offset }),
      }),
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: markerDetail({ character: "!", offset: cases[1]!.offset }),
      }),
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({ detail: markerDetail({ character: "%", offset: 0 }) }),
    ]);
  });
});
