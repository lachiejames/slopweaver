/**
 * Pure: fold the zero-references scan's hits (`./referenceScan.ts`) into what a run reports — a count per class,
 * every known class listed even at zero, and a residue list naming each file still carrying a reference by its
 * classes only. Both come out in a fixed order, so two runs over the same tree print the same bytes.
 *
 * Every class sits in one of two sections. The ACCEPTANCE section is the organisation's: its names, hosts,
 * repositories, people and the owner's employer-linked handle, and the proof passes only when it reads zero.
 * The OWN-NAME section is the owner's personal name and handle alone ({@link OWN_NAME_CLASSES}), reported beside it
 * and never failing the proof: this repository lives under the owner's own account, and the owner's name leaves the
 * code as stateless work rather than as a reference to the organisation.
 */
import { type ReferenceArea, type ReferenceClass, type ReferenceHit, referenceArea } from "./referenceScan.js";

/** The classes that report the owner's personal name and handle, outside the acceptance count. */
const OWN_NAME_CLASSES: ReadonlySet<string> = new Set(["map:owner"]);

/** Which half of the report a class belongs to: the organisation's acceptance gate, or the owner's own name. */
export type ReferenceSection = "acceptance" | "own-name";

/**
 * Pure: the section a class reports under.
 *
 * @param className the class, prefixed by its source
 * @returns `own-name` for the owner's personal name and handle, `acceptance` for everything else
 */
export function referenceSection({ className }: { className: string }): ReferenceSection {
  return OWN_NAME_CLASSES.has(className) ? "own-name" : "acceptance";
}

/** One class's totals over the whole tree. */
interface ReferenceClassCount extends ReferenceClass {
  readonly section: ReferenceSection;
  /** Distinct (file, line) places carrying the class. */
  readonly hits: number;
  readonly files: number;
  readonly codeFiles: number;
  readonly docsFiles: number;
}

/** One section's totals: its places, and the files carrying at least one of its classes. */
interface ReferenceSectionTotals {
  readonly hits: number;
  readonly files: number;
  readonly codeFiles: number;
  readonly docsFiles: number;
}

/** One file that still carries a reference, by its classes only. */
export interface ReferenceResidueFile {
  readonly path: string;
  readonly area: ReferenceArea;
  readonly classes: readonly string[];
  /** The path itself carries a reference, so a surface that must show no name withholds it. */
  readonly pathCarriesReference: boolean;
}

/** The whole tree's outcome. */
export interface ReferenceSummary {
  readonly filesScanned: number;
  readonly binaryFiles: number;
  readonly totalHits: number;
  readonly classes: readonly ReferenceClassCount[];
  readonly residue: readonly ReferenceResidueFile[];
  readonly codeFiles: number;
  readonly docsFiles: number;
  /** The organisation's references: the proof passes only when this reads zero. */
  readonly acceptance: ReferenceSectionTotals;
  /** The owner's personal name and handle, reported beside the acceptance and never failing it. */
  readonly ownName: ReferenceSectionTotals;
}

/**
 * Pure: per-class counts, every known class first and in its own order, then any class only a hit named.
 *
 * @param hits every reference found
 * @param classes the class universe, from `referenceClasses`
 * @returns one count per class
 */
function classCounts({
  hits,
  classes,
}: {
  hits: readonly ReferenceHit[];
  classes: readonly ReferenceClass[];
}): readonly ReferenceClassCount[] {
  const byClass = new Map<string, { source: ReferenceClass["source"]; hits: number; files: Set<string> }>();
  for (const known of classes) {
    byClass.set(known.className, { files: new Set<string>(), hits: 0, source: known.source });
  }
  for (const hit of hits) {
    let entry = byClass.get(hit.className);
    if (entry === undefined) {
      entry = { files: new Set<string>(), hits: 0, source: hit.source };
      byClass.set(hit.className, entry);
    }
    entry.hits += 1;
    entry.files.add(hit.path);
  }
  return [...byClass.entries()].map(([className, entry]) => {
    const files = [...entry.files];
    const docsFiles = files.filter((path) => referenceArea({ path }) === "docs").length;
    return {
      className,
      codeFiles: files.length - docsFiles,
      docsFiles,
      files: files.length,
      hits: entry.hits,
      section: referenceSection({ className }),
      source: entry.source,
    };
  });
}

/**
 * Pure: one section's totals over the hits whose class reports under it.
 *
 * @param hits every reference found
 * @param section which section to total
 * @returns its places and the files carrying any of its classes
 */
function sectionTotals({
  hits,
  section,
}: {
  hits: readonly ReferenceHit[];
  section: ReferenceSection;
}): ReferenceSectionTotals {
  const inSection = hits.filter((hit) => referenceSection({ className: hit.className }) === section);
  const files = [...new Set(inSection.map((hit) => hit.path))];
  const docsFiles = files.filter((path) => referenceArea({ path }) === "docs").length;
  return { codeFiles: files.length - docsFiles, docsFiles, files: files.length, hits: inSection.length };
}

/**
 * Pure: every file carrying a reference, by path, with its classes sorted and whether its path is one.
 *
 * @param hits every reference found
 * @returns the residue, sorted by path
 */
function residueFiles({ hits }: { hits: readonly ReferenceHit[] }): readonly ReferenceResidueFile[] {
  const byFile = new Map<string, { classes: Set<string>; pathHit: boolean }>();
  for (const hit of hits) {
    let file = byFile.get(hit.path);
    if (file === undefined) {
      file = { classes: new Set<string>(), pathHit: false };
      byFile.set(hit.path, file);
    }
    file.classes.add(hit.className);
    file.pathHit = file.pathHit || hit.line === 0;
  }
  return [...byFile.entries()]
    .map(([path, file]) => ({
      area: referenceArea({ path }),
      classes: [...file.classes].toSorted(),
      path,
      pathCarriesReference: file.pathHit,
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * Pure: fold every hit of a tree into per-class counts — every known class, zero included — and a by-file
 * residue list, both in a fixed order so two runs over the same tree print the same bytes.
 *
 * @param hits every reference found
 * @param classes the class universe, from `referenceClasses`
 * @param filesScanned how many files the tree held
 * @param binaryFiles how many of them carried a NUL byte
 * @returns the summary
 */
export function summariseReferences({
  hits,
  classes,
  filesScanned,
  binaryFiles,
}: {
  hits: readonly ReferenceHit[];
  classes: readonly ReferenceClass[];
  filesScanned: number;
  binaryFiles: number;
}): ReferenceSummary {
  const residue = residueFiles({ hits });
  const docsFiles = residue.filter((file) => file.area === "docs").length;
  return {
    acceptance: sectionTotals({ hits, section: "acceptance" }),
    binaryFiles,
    classes: classCounts({ classes, hits }),
    codeFiles: residue.length - docsFiles,
    docsFiles,
    filesScanned,
    ownName: sectionTotals({ hits, section: "own-name" }),
    residue,
    totalHits: hits.length,
  };
}
