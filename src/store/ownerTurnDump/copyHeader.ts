/**
 * Which table a `COPY … FROM stdin;` header names, read the way PostgreSQL reads an identifier rather than by a
 * pattern of the spellings `pg_dump` happens to print today.
 *
 * An unquoted name folds to lower case (`PUBLIC.OWNER_TURN` IS `public.owner_turn`); a quoted one keeps its exact
 * text, a doubled `""` standing for one quote (`public."owner_turn"` is that same table, `public."Owner_Turn"` another).
 * A pattern of spellings lets both a digit in the name and a quoted spelling of our own table through, each read as a
 * table this load steps over, so its rows go unread. A header whose name will
 * not parse is reported as such, for the fold to refuse — never stepped over as somebody else's table.
 */

/** What one line is, read as a COPY header. */
export type CopyHeaderRead =
  /** Not a COPY header at all. */
  | { readonly kind: "none" }
  /** A COPY header whose table name this reader cannot parse. */
  | { readonly kind: "unparsed" }
  | {
      readonly kind: "named";
      /** The schema, folded or exact as written; `undefined` when the name is unqualified. */
      readonly schema: string | undefined;
      readonly table: string;
      /** The column list's text between its parentheses, or `undefined` when the header declares none. */
      readonly columns: string | undefined;
    };

/**
 * Any line that opens with the keyword, in any case and after any whitespace: what COULD be a COPY header. Detection is
 * loose and parsing strict, so a header in a form this reader does not take (a tab after `COPY`, a lower-case keyword,
 * `FROM STDIN`) is `unparsed` and refused, never a line between sections passed over.
 */
const ANY_COPY = /^\s*copy(?![A-Za-z0-9_$])/iu;
const PREFIX = "COPY ";
const SUFFIX = " FROM stdin;";
const UNQUOTED = /^[A-Za-z_][A-Za-z0-9_$]*/u;
const COLUMN_LIST = /^ \((.*)\)$/u;

/**
 * One identifier starting at `index`.
 *
 * @param text the header
 * @param index where the identifier starts
 * @returns the identifier as PostgreSQL resolves it and the index just past it, or `undefined` when none starts there
 */
function identifierAt({ text, index }: { text: string; index: number }): { name: string; end: number } | undefined {
  if (text[index] !== '"') {
    const match = UNQUOTED.exec(text.slice(index));
    if (match === null) {
      return undefined;
    }
    return { end: index + match[0].length, name: match[0].toLowerCase() };
  }
  let name = "";
  let at = index + 1;
  while (at < text.length) {
    if (text[at] !== '"') {
      name += text[at]!;
      at += 1;
    } else if (text[at + 1] === '"') {
      name += '"';
      at += 2;
    } else {
      // PostgreSQL refuses a zero-length quoted identifier, so `""` names no table at all.
      return name === "" ? undefined : { end: at + 1, name };
    }
  }
  return undefined;
}

/**
 * Read one dump line as a COPY header.
 *
 * @param line the line, without its break
 * @returns `none` for a line not opening with `COPY`, `unparsed` for one that does in any form but `pg_dump`'s with a
 *   name that reads, else the table it names
 */
export function readCopyHeader({ line }: { line: string }): CopyHeaderRead {
  if (!ANY_COPY.test(line)) {
    return { kind: "none" };
  }
  if (!line.startsWith(PREFIX) || !line.endsWith(SUFFIX)) {
    return { kind: "unparsed" };
  }
  const body = line.slice(0, -SUFFIX.length);
  const first = identifierAt({ index: PREFIX.length, text: body });
  if (first === undefined) {
    return { kind: "unparsed" };
  }
  let schema: string | undefined;
  let table = first;
  if (body[first.end] === ".") {
    const second = identifierAt({ index: first.end + 1, text: body });
    if (second === undefined) {
      return { kind: "unparsed" };
    }
    schema = first.name;
    table = second;
  }
  const rest = body.slice(table.end);
  if (rest === "") {
    return { columns: undefined, kind: "named", schema, table: table.name };
  }
  const columns = COLUMN_LIST.exec(rest);
  if (columns === null) {
    return { kind: "unparsed" };
  }
  return { columns: columns[1]!, kind: "named", schema, table: table.name };
}
