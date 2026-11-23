/**
 * The recurring-failure register's pages, and the one place that reads every one of them.
 *
 * ## Why a list, and why drift from it is a problem rather than a silence
 *
 * The register is `docs/recurring-failure-register.md` and the child pages beside it, one per section family,
 * because a single 754-line page broke the every-doc-under-300-lines rule. Its readers
 * used to open one file, and a reader that opens fewer pages than there are reports FEWER classes rather than
 * wrong ones, which is the direction `./registerDoc.ts` calls missing-is-safe and `register-bindings` would
 * have reported clean. So the pages are declared once here, in reading order, and both directions of drift
 * are a {@link RegisterProblem}: a listed page that is absent, and a `.md` in the register's directory that
 * nobody listed. A page's expected opening section is declared too, so a child renamed or swapped at the
 * right path is named rather than read as the wrong section.
 *
 * ## What each reader does with a page it could not read
 *
 * All three read through {@link loadRegister} and decide for themselves, because the right answer differs:
 * `register-bindings` refuses on the problem; `turn freeze --regresses` checks nothing and says so whenever
 * any page is unread, since validating against a partial inventory would reject a real class whose page is
 * the absent or misread one; and the reflect brief keeps what it read, since a missing Refuted page there
 * means only fewer refutations to match.
 *
 * Pure: the filesystem arrives as a `SubstrateReader`, the loop's existing seam.
 */

import { dirname, join, relative } from "node:path";

import { parseRegisterDoc, REGISTER_RELATIVE_PATH, type RegisterDoc, type RegisterProblem } from "./registerDoc.js";
import { headingsOutsideFences, type RegisterSection, sectionOf } from "./registerSections.js";
import type { SubstrateReader } from "./substrate.js";

/** Where the register's child pages live, relative to the repository root. */
export const REGISTER_DIRECTORY_RELATIVE_PATH = join("docs", "recurring-failure-register");

/** One page of the register. */
export interface RegisterPage {
  /** Repo-relative. */
  readonly path: string;
  /** The section the page's first heading opens; the parent opens none. */
  readonly opens?: RegisterSection;
  /**
   * Any further section a later heading on the page opens. A child's headings were raised to a floor of `##`,
   * so a `##` there may once have been a `###` that opened nothing; naming what each page holds is what tells
   * a real section from a subheading that happens to start with a section's name.
   */
  readonly alsoOpens?: readonly RegisterSection[];
}

/** Every page, in reading order: the parent, then its children as its index lists them. */
export const REGISTER_PAGES: readonly RegisterPage[] = [
  { path: REGISTER_RELATIVE_PATH },
  { opens: "survivors", path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "survivors.md") },
  { opens: "gated", path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "gated.md") },
  {
    alsoOpens: ["filed"],
    opens: "refuted",
    path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "refuted-and-seed-candidates.md"),
  },
  { opens: "ownerRuled", path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "owner-ruled-additions.md") },
  { opens: "ownerRuled", path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "silent-checks.md") },
  { opens: "bindings", path: join(REGISTER_DIRECTORY_RELATIVE_PATH, "bindings.md") },
];

/** The whole register as read, and which pages could not be read cleanly. */
export interface LoadedRegister {
  readonly doc: RegisterDoc;
  /**
   * Repo-relative paths of every page carrying a problem — absent, opening the wrong section, holding a row
   * the parser could not read, or unlisted — so a caller that must not judge a partial inventory can refuse to.
   */
  readonly unread: readonly string[];
}

/**
 * Read and parse every page, merging them in reading order.
 *
 * @param reader the filesystem seam
 * @param parentPath the absolute path of the parent page; every other page resolves beside it
 * @returns the merged register, with every drift from {@link REGISTER_PAGES} among its problems
 */
export function loadRegister({ reader, parentPath }: { reader: SubstrateReader; parentPath: string }): LoadedRegister {
  const docsDir = dirname(parentPath);
  const at = ({ path }: { path: string }): string => join(docsDir, relative(dirname(REGISTER_RELATIVE_PATH), path));
  const read = REGISTER_PAGES.map((page) => ({ page, text: reader.readText(at({ path: page.path })) }));
  const present = read.flatMap(({ page, text }) => (text === undefined ? [] : [{ page, text }]));
  const docs = present.map(({ page, text }) => parseRegisterDoc({ path: page.path, text }));
  const missing = read.filter(({ text }) => text === undefined).map(({ page }) => page.path);
  const problems: readonly RegisterProblem[] = [
    ...docs.flatMap((doc) => doc.problems),
    ...present.flatMap(({ page, text }) => headingProblems({ page, text })),
    ...missing.map((path) => ({ message: "listed in REGISTER_PAGES and absent — restore it, or unlist it", path })),
    ...directoryProblems({
      names: reader.listNames(at({ path: REGISTER_DIRECTORY_RELATIVE_PATH })),
      read: present.map(({ page }) => page.path),
    }),
  ];
  return {
    doc: { bindings: docs.flatMap((doc) => doc.bindings), classes: docs.flatMap((doc) => doc.classes), problems },
    unread: [...new Set(problems.map((problem) => problem.path))],
  };
}

/**
 * Whether a page's `#` title opens the section it is listed as opening, and it opens no section it is not listed
 * as holding. A child has exactly one `#` title: one demoted to `##`, or a second `#` later, would end the
 * section early at a heading that was a `###` on the single page.
 *
 * @param page the listed page
 * @param text its contents
 * @returns one problem when the first heading opens a different section, and one per heading opening a section
 *   the page does not hold
 */
function headingProblems({ page, text }: { page: RegisterPage; text: string }): readonly RegisterProblem[] {
  const { headings, unclosed } = headingsOutsideFences({ text });
  const { alsoOpens = [] } = page;
  const holds = new Set<RegisterSection | undefined>([undefined, page.opens, ...alsoOpens]);
  const problems: RegisterProblem[] = [];
  const first = headings[0];
  const opened = first?.startsWith("# ") === true ? sectionOf({ heading: first }) : undefined;
  if (page.opens !== undefined && opened !== page.opens) {
    problems.push({
      message: `has no \`#\` title opening the \`${page.opens}\` section, which REGISTER_PAGES lists it as opening`,
      path: page.path,
    });
  }
  if (unclosed) {
    problems.push({
      message: "ends inside a code fence, which hides every line after it — close the fence",
      path: page.path,
    });
  }
  const later = page.opens === undefined ? headings : headings.slice(1);
  if (page.opens !== undefined && later.some((one) => one.startsWith("# "))) {
    problems.push({
      message: "holds a second `#` title, which would end its section early — a child has one",
      path: page.path,
    });
  }
  for (const heading of later.filter((one) => !holds.has(sectionOf({ heading: one })))) {
    const message = `"${heading}" opens a section REGISTER_PAGES does not list this page as holding — rename it, or list it`;
    problems.push({ message, path: page.path });
  }
  return problems;
}

/**
 * What the register's directory listing says is wrong: a page nobody listed, any other entry, or a listing that
 * cannot be trusted to show one.
 *
 * The reader seam answers an unreadable directory with an empty listing, so a listing that omits a child page
 * this load just READ is not a clean directory — it is one whose unlisted pages would be invisible too, and
 * it is named as a problem on the directory rather than passed as clean.
 *
 * @param names the entry names directly under the directory
 * @param read the repo-relative paths of every page that was read
 * @returns one problem per unlisted entry, and one for the directory when its listing misses a read child
 */
function directoryProblems({
  names,
  read,
}: {
  names: readonly string[];
  read: readonly string[];
}): readonly RegisterProblem[] {
  const listed = new Set(names.map((name) => join(REGISTER_DIRECTORY_RELATIVE_PATH, name)));
  const children = read.filter((path) => dirname(path) === REGISTER_DIRECTORY_RELATIVE_PATH);
  const unlistable = children.some((path) => !listed.has(path));
  return [
    ...unlistedEntries({ names }).map((path) => ({
      message: path.endsWith(".md")
        ? "a register page REGISTER_PAGES does not list, so no reader opens it — list it in reading order"
        : "not a register page — the directory holds only its listed pages, so a subdirectory or other file there could hide one; move it out",
      path,
    })),
    ...(unlistable
      ? [
          {
            message: "the directory listing omits a page that was read, so an unlisted page there could not be seen",
            path: REGISTER_DIRECTORY_RELATIVE_PATH,
          },
        ]
      : []),
  ];
}

/**
 * Every entry in the register's directory that {@link REGISTER_PAGES} does not list — an unlisted page, and
 * anything else, because the listing is one level deep and a subdirectory could hold a page nobody would read.
 *
 * @param names the entry names directly under the directory
 * @returns their repo-relative paths
 */
function unlistedEntries({ names }: { names: readonly string[] }): readonly string[] {
  return names
    .map((name) => join(REGISTER_DIRECTORY_RELATIVE_PATH, name))
    .filter((path) => !REGISTER_PAGES.some((page) => page.path === path));
}
