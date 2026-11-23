"use client";

/*
 * The app icon a citation chip draws: the integration's own mark, the way the site's favicon reads at a glance, and
 * a neutral link glyph in the integration's colour where no mark is bundled — never letters like CF; the Slack logo on
 * the thread link is the model. A mark is BUNDLED, never fetched: a favicon loaded on render is a request the browser
 * makes to that host before the owner follows anything, the egress `../../lib/markdownSafety.ts` refuses.
 *
 * The drawn marks are the archive's (`slopweaver-archive/packages/ui/src/atoms/icons/*-icon.tsx`), re-made as one
 * table of vector paths rather than a file per platform; the rest are simple-icons' (CC0), imported one by one so
 * only the marks drawn are bundled. Which mark a kind draws, and its colour, are the registry's
 * (`../../lib/citationKinds.ts`); this file only draws.
 */

import {
  CircleDot,
  FileText,
  Globe,
  Inbox,
  LayoutList,
  Link2,
  type LucideIcon,
  Mic,
  SquareTerminal,
} from "lucide-react";
import { createElement, type ReactElement } from "react";
import {
  type SimpleIcon,
  si1password,
  siAirtable,
  siClerk,
  siCloudflare,
  siDatadog,
  siFathom,
  siGoogle,
  siGooglecalendar,
  siGooglechronicle,
  siGooglegemini,
  siNx,
  siPrisma,
  siXero,
} from "simple-icons";

import type { CitationKind } from "@/lib/citationKinds";

import { SlopweaverMark } from "../SlopweaverMark";

/** One filled path of a drawn mark, in its own colour or the chip's `currentColor`. */
interface MarkPath {
  readonly d: string;
  readonly fill: string;
}

/** A drawn mark: its view box and paths. */
interface DrawnMark {
  readonly viewBox: string;
  readonly paths: readonly MarkPath[];
}

/** The integrations whose own mark is drawn, keyed by the registry's `mark`. */
const DRAWN = new Map<string, DrawnMark>(
  Object.entries({
    figma: {
      paths: [
        { d: "M8 24c2.208 0 4-1.792 4-4v-4H8c-2.208 0-4 1.792-4 4s1.792 4 4 4z", fill: "#0ACF83" },
        { d: "M4 12c0-2.208 1.792-4 4-4h4v8H8c-2.208 0-4-1.792-4-4z", fill: "#A259FF" },
        { d: "M4 4c0-2.208 1.792-4 4-4h4v8H8C5.792 8 4 6.208 4 4z", fill: "#F24E1E" },
        { d: "M12 0h4c2.208 0 4 1.792 4 4s-1.792 4-4 4h-4V0z", fill: "#FF7262" },
        { d: "M20 12c0 2.208-1.792 4-4 4s-4-1.792-4-4 1.792-4 4-4 4 1.792 4 4z", fill: "#1ABCFE" },
      ],
      viewBox: "0 0 24 24",
    },
    github: {
      paths: [
        {
          d: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
          fill: "currentColor",
        },
      ],
      viewBox: "0 0 24 24",
    },
    gmail: {
      paths: [
        { d: "M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6", fill: "#4285F4" },
        { d: "M120 108h14c3.32 0 6-2.69 6-6V59l-20 15", fill: "#34A853" },
        { d: "M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2", fill: "#FBBC04" },
        { d: "M72 74V48l24 18 24-18v26L96 92", fill: "#EA4335" },
        { d: "M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2", fill: "#C5221F" },
      ],
      viewBox: "52 42 88 66",
    },
    googleDrive: {
      paths: [
        { d: "m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z", fill: "#0066DA" },
        { d: "m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z", fill: "#00AC47" },
        {
          d: "m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z",
          fill: "#EA4335",
        },
        { d: "m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z", fill: "#00832D" },
        { d: "m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z", fill: "#2684FC" },
        {
          d: "m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z",
          fill: "#FFBA00",
        },
      ],
      viewBox: "0 0 87.3 78",
    },
    microsoft: {
      paths: [
        { d: "M0 0h11v11H0z", fill: "#F25022" },
        { d: "M12 0h11v11H12z", fill: "#7FBA00" },
        { d: "M0 12h11v11H0z", fill: "#00A4EF" },
        { d: "M12 12h11v11H12z", fill: "#FFB900" },
      ],
      viewBox: "0 0 23 23",
    },
    linear: {
      paths: [
        {
          d: "M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z",
          fill: "#5E6AD2",
        },
      ],
      viewBox: "0 0 100 100",
    },
    notion: {
      paths: [
        {
          d: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.166V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM2.64 1.782l13.168-.933c1.634-.14 2.055-.047 3.082.7l4.25 2.986c.7.513.933.653.933 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V3.51c0-.839.374-1.54 1.589-1.727z",
          fill: "currentColor",
        },
      ],
      viewBox: "0 0 24 24",
    },
    slack: {
      paths: [
        {
          d: "M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z",
          fill: "#E01E5A",
        },
        {
          d: "M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z",
          fill: "#36C5F0",
        },
        {
          d: "M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z",
          fill: "#2EB67D",
        },
        {
          d: "M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z",
          fill: "#ECB22E",
        },
      ],
      viewBox: "0 0 127 127",
    },
  }),
);

/**
 * The simple-icons brand marks, keyed by the registry's `mark`, each filled with the registry's colour rather than
 * simple-icons' own hex — a near-black one (Prisma's, Nx's) would vanish on the dark page.
 */
const BRANDS = new Map<string, SimpleIcon>(
  Object.entries({
    "1password": si1password,
    airtable: siAirtable,
    clerk: siClerk,
    cloudflare: siCloudflare,
    datadog: siDatadog,
    fathom: siFathom,
    google: siGoogle,
    googlecalendar: siGooglecalendar,
    googlechronicle: siGooglechronicle,
    googlegemini: siGooglegemini,
    nx: siNx,
    prisma: siPrisma,
    xero: siXero,
  }),
);

/** The glyph each internal kind draws — a place in this console, not an integration, so no brand mark. */
const INTERNAL = new Map<string, LucideIcon>(
  Object.entries({
    board: LayoutList,
    console: SquareTerminal,
    page: FileText,
    queue: Inbox,
    talk: Mic,
    web: Globe,
    workstream: CircleDot,
  }),
);

/**
 * The app icon for one citation kind, `size` pixels square.
 *
 * @param kind the registry row the citation resolved to
 * @param size the edge length in pixels
 * @returns the drawn mark, a brand mark, the Slopweaver mark, an internal glyph, or the neutral link glyph
 */
export function CitationMark({ kind, size = 12 }: { kind: CitationKind; size?: number }): ReactElement {
  const brand = BRANDS.get(kind.mark);
  if (brand !== undefined) {
    return (
      <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d={brand.path} fill={kind.colour} />
      </svg>
    );
  }
  const drawn = DRAWN.get(kind.mark);
  if (drawn !== undefined) {
    return (
      <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox={drawn.viewBox} className="shrink-0">
        {drawn.paths.map((path) => (
          <path key={path.d.slice(0, 24)} d={path.d} fill={path.fill} />
        ))}
      </svg>
    );
  }
  if (kind.mark === "slopweaver") {
    return <SlopweaverMark size={size} />;
  }
  // A registry icon drawn by reference: the icon components are declared once, in lucide, never made here. A kind with
  // no mark of its own draws the neutral link glyph.
  const glyph = INTERNAL.get(kind.mark);
  return createElement(glyph === undefined ? Link2 : glyph, {
    "aria-hidden": true,
    className: "shrink-0",
    height: size,
    style: { color: kind.colour },
    width: size,
  });
}
