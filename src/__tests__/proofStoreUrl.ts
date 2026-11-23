/**
 * The one guard a test runs before it writes into a "throwaway" proof store it was handed by URL, so a mistyped
 * variable can never point a test's schema push or row clearing at the live fleet's `postgres` database.
 *
 * An ALLOWLIST of URL shape rather than a match on one spelling, because two spellings slipped past the match:
 * `/postgre%73` (a percent-encoded path) and `?database=postgres` (postgres-js reads a query parameter as a
 * startup parameter that overrides the path). So the URL may carry no query and no fragment at all, and its
 * decoded database name must be present and must not be `postgres`.
 */

/**
 * Throw unless `url` names one database other than `postgres`, with nothing that could override that choice.
 *
 * @param url the proof store's connection string, as the test was handed it
 * @param variable the environment variable it came from, named in the refusal
 */
export function refuseLiveStore({ url, variable }: { url: string; variable: string }): void {
  const parsed = new URL(url);
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `${variable} carries a query or fragment, which could select another database — name it by path only`,
    );
  }
  const database = decodeURIComponent(parsed.pathname).replace(/^\//u, "");
  if (database === "" || database === "postgres") {
    throw new Error(`${variable} names the \`postgres\` database (or none), the live fleet's — use a throwaway one`);
  }
}
