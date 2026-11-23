import { describe, expect, it } from "vitest";

import { deriveSurfaces, type SurfaceReport } from "../../../appSurfaces/derive.js";
import { ROOT_ROUTE } from "../../../appSurfaces/moduleFacts.js";
import { publicRoutePath } from "../../../appSurfaces/placeNames.js";
import { DEFAULT_EVERYWHERE_AT } from "../../../appSurfaces/threshold.js";
import { surfaceReportLines } from "../../../cli/commands/github/vulnRun.js";

/**
 * A two-app monorepo in memory. A shared utils package has a barrel that re-exports a sanitiser and a date
 * formatter; the sanitiser imports dompurify. One app route renders a viewer that sanitises, another only
 * formats a date through the same barrel — the case a file-level walk gets wrong.
 */
const FILES: Readonly<Record<string, string>> = {
  "packages/utils/package.json": JSON.stringify({ exports: { ".": "./src/index.ts" }, name: "@acme/utils" }),
  "packages/utils/src/index.ts": 'export * from "./sanitise";\nexport * from "./date";',
  "packages/utils/src/sanitise.ts":
    'import DOMPurify from "dompurify";\nexport const clean = (h) => DOMPurify.sanitize(h);',
  "packages/utils/src/date.ts": "export const formatDate = (d) => String(d);",
  "packages/utils/src/__tests__/sanitise.test.ts": 'import { clean } from "../sanitise";\nit("x", () => clean("a"));',
  "apps/web/package.json": JSON.stringify({ name: "web" }),
  "apps/web/src/components/ResultViewer.tsx":
    'import { clean } from "@acme/utils";\nexport const ResultViewer = ({ h }) => <div>{clean(h)}</div>;',
  "apps/web/src/components/ResultViewer.test.tsx":
    'import { ResultViewer } from "./ResultViewer";\nit("renders", () => ResultViewer({ h: "" }));',
  "apps/web/src/routes/_auth/reports.$reportId.tsx":
    "import { ResultViewer } from '../../components/ResultViewer';\n" +
    "export const Route = createFileRoute('/_auth/reports/$reportId')({ component: () => <ResultViewer h='' /> });",
  "apps/web/src/routes/_auth/calendar.tsx":
    "import { formatDate } from '@acme/utils';\n" +
    "export const Route = createFileRoute('/_auth/calendar')({ component: () => formatDate(1) });",
  "apps/web/src/components/Orphan.tsx": 'import { clean } from "@acme/utils";\nexport const Orphan = () => clean("");',
  "apps/web/src/routeTree.gen.ts":
    "import { Route as A } from './routes/_auth/reports.$reportId';\nimport { Route as B } from './routes/_auth/calendar';\nexport const tree = [A, B];",
  "apps/jobs/package.json": JSON.stringify({ name: "jobs" }),
  "apps/jobs/src/functions/digest.ts":
    'import { clean } from "@acme/utils";\nexport default { handler: () => clean("") };',
};

/** A route that starts a worker by URL — no import statement names the worker. */
const WORKER_FILES: Readonly<Record<string, string>> = {
  ...FILES,
  "apps/web/src/workers/sanitise.ts": 'import { clean } from "@acme/utils";\nself.onmessage = (e) => clean(e.data);',
  "apps/web/src/routes/_auth/export.tsx":
    "const worker = new Worker(new URL('../../workers/sanitise.ts', import.meta.url));\n" +
    "export const Route = createFileRoute('/_auth/export')({ component: () => worker });",
};

/** Derive over a fixture checkout, the shared one unless another is named. */
function derive({
  packageName,
  everywhereAt,
  files = FILES,
}: {
  packageName: string;
  everywhereAt: number;
  files?: Readonly<Record<string, string>>;
}): SurfaceReport {
  return deriveSurfaces({ everywhereAt, packageName, read: (path) => files[path], tracked: Object.keys(files) });
}

describe("deriveSurfaces", () => {
  const report = derive({ everywhereAt: 12, packageName: "dompurify" });

  it("names the route that renders the sanitiser, and not the route that only formats a date through the barrel", () => {
    expect(report.surfaces.map((surface) => surface.where)).toEqual([
      "jobs: src/functions/digest.ts (nothing imports it — an entry point, a job loaded by directory, or dead code)",
      "web /reports/$reportId",
    ]);
  });

  it("follows a worker loaded by URL, which no import statement names, to the route that starts it", () => {
    const withWorker = derive({ everywhereAt: 12, files: WORKER_FILES, packageName: "dompurify" });
    const route = withWorker.surfaces.find((surface) => surface.where === "web /export")!;
    expect(route.chain.slice(0, 2)).toEqual([
      "apps/web/src/routes/_auth/export.tsx",
      "apps/web/src/workers/sanitise.ts",
    ]);
    expect(withWorker.deadEnds.map((deadEnd) => deadEnd.module)).not.toContain("apps/web/src/workers/sanitise.ts");
  });

  it("stops at the route rather than walking on into the generated route tree", () => {
    expect(report.surfaces.map((surface) => surface.module)).not.toContain("apps/web/src/routeTree.gen.ts");
    expect(report.surfaces.map((surface) => surface.module)).toContain(
      "apps/web/src/routes/_auth/reports.$reportId.tsx",
    );
  });

  it("chains a surface down through the barrel to the module that imports the package", () => {
    const route = report.surfaces.find((surface) => surface.kind === "route")!;
    expect(route.chain).toEqual([
      "apps/web/src/routes/_auth/reports.$reportId.tsx",
      "apps/web/src/components/ResultViewer.tsx",
      "packages/utils/src/index.ts",
      "packages/utils/src/sanitise.ts",
    ]);
  });

  it("groups the surfaces by the component that USES the package, never the barrel that only passes it on", () => {
    expect(report.features.map((feature) => [feature.name, feature.surfaces.length, feature.cover])).toEqual([
      ["digest", 1, ["packages/utils/src/__tests__/sanitise.test.ts"]],
      [
        "ResultViewer",
        1,
        ["apps/web/src/components/ResultViewer.test.tsx", "packages/utils/src/__tests__/sanitise.test.ts"],
      ],
    ]);
  });

  it("calls a module nothing imports in a routed app dead code, never a place to go", () => {
    expect(report.surfaces.map((surface) => surface.module)).not.toContain("apps/web/src/components/Orphan.tsx");
    expect(report.deadEnds).toContainEqual({
      module: "apps/web/src/components/Orphan.tsx",
      why: "nothing imports it, and its app reaches every page through the router, so it is dead code — unless an import.meta.glob loads it, which the walk cannot read",
    });
  });

  it("reports the modules that import the package directly as the code sites", () => {
    expect(report.seeds).toEqual(["packages/utils/src/sanitise.ts"]);
  });

  it("drafts a blast radius the vulnerability-fix form can take, one row per feature", () => {
    expect(report.blastRadius).toEqual({
      kind: "surfaces",
      surfaces: [
        {
          regressionCover: "covered by sanitise.test.ts",
          where:
            "digest via sanitise, on jobs: src/functions/digest.ts (nothing imports it — an entry point, a job loaded by directory, or dead code)",
        },
        {
          regressionCover: "covered by ResultViewer.test.tsx, sanitise.test.ts",
          where: "ResultViewer via sanitise, on web /reports/$reportId",
        },
      ],
    });
  });
});

describe("deriveSurfaces thresholds and absences", () => {
  it("answers everywhere once the features reach the fan-in, with the counts as its reason", () => {
    const report = derive({ everywhereAt: 2, packageName: "dompurify" });
    expect(report.blastRadius).toEqual({
      kind: "everywhere",
      why: "dompurify is imported directly by 1 modules and pulled in by 2 components, in 2 places across 2 apps; there is no one place to open.",
    });
  });

  it("answers unreached when nothing in the checkout imports the package", () => {
    const report = derive({ everywhereAt: 12, packageName: "left-pad" });
    expect(report.blastRadius).toEqual({
      kind: "unreached",
      why: "no tracked module imports left-pad; it arrives through a parent — run this on the parent",
    });
    expect(report.surfaces).toEqual([]);
  });
});

describe("publicRoutePath", () => {
  it("drops pathless layout and group segments, as the address bar does", () => {
    expect(publicRoutePath({ routePath: "/_auth/_admin/model-view/$modelName/$id" })).toBe(
      "/model-view/$modelName/$id",
    );
    expect(publicRoutePath({ routePath: "/(marketing)/pricing" })).toBe("/pricing");
    expect(publicRoutePath({ routePath: "/plans_/care-plans/$carePlanId" })).toBe("/plans/care-plans/$carePlanId");
  });

  it("reads a layout route as every page it wraps, never as the one page its path names", () => {
    expect(publicRoutePath({ routePath: "/_auth/_admin" })).toBe("every page in the _admin layout, under /");
    expect(publicRoutePath({ routePath: "/settings/_layout" })).toBe(
      "every page in the _layout layout, under /settings",
    );
  });

  it("reads an index route, spelled with a trailing slash, as the one page it is and never as its layout", () => {
    expect(publicRoutePath({ routePath: "/_authed/" })).toBe("/");
    expect(publicRoutePath({ routePath: "/_auth/customers/$id/documents/$documentId/" })).toBe(
      "/customers/$id/documents/$documentId",
    );
  });

  it("reads the root route as every page", () => {
    expect(publicRoutePath({ routePath: ROOT_ROUTE })).toBe("every page");
  });
});

describe("surfaceReportLines", () => {
  it("leads with the counts and the answer, and ends with the residue it could not see", () => {
    const lines = surfaceReportLines({ report: derive({ everywhereAt: 12, packageName: "dompurify" }) });
    expect(lines.slice(0, 2)).toEqual([
      "dompurify: 2 feature(s) in 2 place(s), from 1 importing module(s); 11 modules scanned",
      "blast radius: surfaces (everywhere at 12 direct importers or features)",
    ]);
    expect(lines.at(-1)).toContain("residue: 0 local code specifier(s) named nothing tracked");
  });
});

describe("DEFAULT_EVERYWHERE_AT", () => {
  it("sits above the widest measured local package and at or below the narrowest measured everywhere one", () => {
    // Measured on acme-admin —dompurify: 3 importers, 6 features; lodash: 31 importers, 18 features.
    expect(DEFAULT_EVERYWHERE_AT).toBeGreaterThan(6);
    expect(DEFAULT_EVERYWHERE_AT).toBeLessThanOrEqual(18);
  });
});
