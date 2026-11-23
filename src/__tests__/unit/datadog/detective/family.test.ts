import { describe, expect, it } from "vitest";

import {
  isLogSurface,
  SHAPE_FAMILIES,
  SHAPE_FAMILY_SPECS,
  type ShapeFamily,
  type ShapeFamilySpec,
  shapeFamilySpec,
} from "../../../../datadog/detective/family.js";

describe("SHAPE_FAMILIES", () => {
  it("declares exactly the five families, in catalogue order", () => {
    expect(SHAPE_FAMILIES).toEqual(["log", "span", "rum-session", "rum-error", "error"]);
  });
});

describe("SHAPE_FAMILY_SPECS", () => {
  it("declares one spec per family, each with its meaning, selector and site priority list", () => {
    const expected: readonly ShapeFamilySpec[] = [
      {
        family: "log",
        meaning: "a log line, keyed on the emitting site its own message names",
        selector: "",
        siteFrom: [],
      },
      {
        family: "span",
        meaning: "a span, keyed on the operation it names and the resource it names underneath",
        selector: "",
        siteFrom: ["operation_name", "resource_name"],
      },
      {
        family: "rum-session",
        meaning: "a browser session, keyed on the application and the route group the view was on",
        selector: "@type:view",
        siteFrom: ["view.url_path_group", "view.url_path"],
      },
      {
        family: "rum-error",
        meaning: "a browser error, keyed on the application and the error's own kind",
        selector: "@type:error",
        siteFrom: ["error.type", "error.source"],
      },
      {
        family: "error",
        meaning: "an error log, keyed on the error code it carries rather than on the line that wrote it",
        selector: "status:error",
        siteFrom: ["err.code", "error.kind", "error.type"],
      },
    ];
    expect(SHAPE_FAMILY_SPECS).toEqual(expected);
  });
});

describe("shapeFamilySpec", () => {
  it("returns each family's declared spec, in catalogue order", () => {
    expect(SHAPE_FAMILIES.length).toBeGreaterThan(0);
    expect(SHAPE_FAMILIES.map((family) => shapeFamilySpec({ family }))).toEqual(SHAPE_FAMILY_SPECS);
  });

  it("looks a family up by id rather than by position", () => {
    expect(shapeFamilySpec({ family: "error" }).selector).toBe("status:error");
    expect(shapeFamilySpec({ family: "rum-session" }).siteFrom).toEqual(["view.url_path_group", "view.url_path"]);
  });
});

describe("isLogSurface", () => {
  it("routes log and error to the logs surface, and span and both RUM families elsewhere", () => {
    const routed: Record<ShapeFamily, boolean> = {
      error: isLogSurface({ family: "error" }),
      log: isLogSurface({ family: "log" }),
      "rum-error": isLogSurface({ family: "rum-error" }),
      "rum-session": isLogSurface({ family: "rum-session" }),
      span: isLogSurface({ family: "span" }),
    };
    expect(routed).toEqual({ error: true, log: true, "rum-error": false, "rum-session": false, span: false });
  });

  it("answers for every declared family, two of the five on the logs surface", () => {
    expect(SHAPE_FAMILIES.filter((family) => isLogSurface({ family }))).toEqual(["log", "error"]);
  });
});
