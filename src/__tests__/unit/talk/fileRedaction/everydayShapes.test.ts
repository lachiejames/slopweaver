/*
 * The credential shapes an ordinary file carries, masked by `redactCredentials`: a note's or a shell history's
 * flags, config lines and URL passwords, a password in a JSON body or on a command line, the r3 review's shapes,
 * source kept readable where config is masked, a credential a transcript escapes up to four times, and a page with
 * none left untouched. Every secret-shaped fixture is assembled at run time, so this file is not itself a hit for
 * the hygiene gate it exercises.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials } from "../../../../talk/fileRedaction.js";

describe("redactCredentials", () => {
  it("masks the shapes an ordinary note or shell history carries: flags, config lines, URL passwords, bare keys", () => {
    const notion = `${["nt", "n_"].join("")}${"c3".repeat(20)}`;
    const gitlab = `${["glp", "at-"].join("")}${"d4".repeat(12)}`;
    const huggingface = `${["h", "f_"].join("")}${"e5".repeat(18)}`;
    const hex = "0123456789abcdef".repeat(2);
    const url = ["postgres://app:", "hunter", "@db.local/app"].join("");
    const text = [
      `curl --token ${hex}`,
      "DB_PASS=correcthorse",
      "  password: a&bcdef",
      url,
      "mysql -u root -phunterpw app",
      `${notion} ${gitlab} ${huggingface}`,
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "curl --token [redacted:hex-key]",
        "DB_PASS=[redacted:secret-env]",
        "  password: [redacted:secret-config]",
        "postgres://app:[redacted:url-password]@db.local/app",
        "mysql -u root -p[redacted:secret-flag] app",
        "[redacted:notion-token] [redacted:gitlab-token] [redacted:huggingface-token]",
        "",
      ].join("\n"),
    );
  });

  it("masks a password wherever a history, a JSON body or a command line puts it", () => {
    const webhook = ["https://hooks.slack.com/services/", "T000/B000/", "x".repeat(24)].join("");
    const slackClient = `${["xo", "xc"].join("")}-${"1".repeat(12)}-abcdef`;
    const basic = ["Authorization: Ba", "sic dXNlcjpwYXNzd29yZA=="].join("");
    const text = [
      ": 1727000000:0;export DB_PASSWORD=correcthorsebattery",
      "cd app && DB_PASS=Pa(ss)word99xyz ./run",
      '{"password":"correcthorsebattery"}',
      'password: "correct horse battery staple"',
      "PASSWORD=abcd#efghijklmn",
      "redis://:hunterredispw@localhost:6379",
      "curl -u admin:s3cretAdminPw https://x",
      "sshpass -p hunterssh ssh host",
      "the password is hunterplain",
      `${basic} ${webhook} ${slackClient}`,
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        ": 1727000000:0;export DB_PASSWORD=[redacted:secret-env]",
        "cd app && DB_PASS=[redacted:secret-env] ./run",
        '{"password":"[redacted:secret-quoted]"}',
        'password: "[redacted:secret-quoted]"',
        "PASSWORD=[redacted:secret-env]",
        "redis://:[redacted:url-password]@localhost:6379",
        "curl -u admin:[redacted:secret-flag] https://x",
        "sshpass -p [redacted:secret-flag] ssh host",
        "the password is [redacted:secret-prose]",
        "Authorization: Basic [redacted:basic-auth] https://[redacted:slack-webhook] [redacted:slack-token]",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r3 review read back: keys, stray quotes, escapes, flags, XML and block scalars", () => {
    const pulumi = `${["pu", "l-"].join("")}${"ab12".repeat(10)}`;
    const supabase = `${["sb", "p_"].join("")}${"cd34".repeat(10)}`;
    const text = [
      `{"https://api.pulumi.com": "${pulumi}"} ${supabase}`,
      "  password: pa;ss,wo(rd)#x",
      "DD_APP_KEY=ddappvalue SIGNING_KEY=signvalue",
      "DB_PASS=ab'cdef",
      String.raw`{"password":"ab\"cdef"}`,
      "postgres://app:p@ss@db.local/app",
      'x db_password=short && psql "host=db password=libpqpw"',
      "docker login -u me -p dockerpw && redis-cli -a redispw",
      "openssl rsa -passin pass:opensslpw && keytool -storepass keytoolpw",
      '<password>xmlpw</password> <add key="ApiPassword" value="dotnetpw" />',
      "db:",
      "  password: |",
      "    blockline1",
      "    blockline2",
      "  host: db",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        '{"https://api.pulumi.com": "[redacted:pulumi-token]"} [redacted:supabase-token]',
        "  password: [redacted:secret-config]",
        "DD_APP_KEY=[redacted:secret-env] SIGNING_KEY=[redacted:secret-env]",
        "DB_PASS=[redacted:secret-env]",
        '{"password":"[redacted:secret-quoted]"}',
        "postgres://app:[redacted:url-password]@db.local/app",
        'x db_password=[redacted:secret-param] && psql "host=db password=[redacted:secret-param]"',
        "docker login -u me -p [redacted:secret-flag] && redis-cli -a [redacted:secret-flag]",
        "openssl rsa -passin pass:[redacted:secret-flag] && keytool -storepass [redacted:secret-flag]",
        '<password>[redacted:secret-xml]</password> <add key="ApiPassword" value="[redacted:secret-xml]" />',
        "db:",
        "  password: |",
        "[redacted:secret-block]",
        "  host: db",
        "",
      ].join("\n"),
    );
  });

  it("keeps a type annotation, a member, a call and an argument in source, and masks the same lines in config", () => {
    const text = [
      "interface A {",
      "  token: string;",
      "  password: string,",
      "  secret: Secret;",
      "  apiKey: readonly string[];",
      "}",
      "const x = { token: getToken(), password: pw, key: Map<string, string> };",
      "if (a.token===b) {}",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: true, text })).toEqual({ redactions: [], text });
    const config = "password: Welcome1;\ndb_password: Autumn2025,\napi_key: k3y<Angle9\npassword: Tr0ub(4dor)\n";
    expect(redactCredentials({ denylist: [], source: false, text: config }).text).toBe(
      "password: [redacted:secret-config]\ndb_password: [redacted:secret-config]\n" +
        "api_key: [redacted:secret-config]\npassword: [redacted:secret-config]\n",
    );
  });

  it("masks a credential a transcript row escapes, once or twice, over-masking through an escaped line break", () => {
    // As escaped, `shortPw9\n\"password\":` is one unspaced value; cutting a value at a backslash would leak
    // the tail of any secret that holds one, so the mask runs on to the next space instead.
    const once = String.raw`{"content":"cat db.yml\n  password: shortPw9\n\"password\": \"JsonInJsonlPw9\""}`;
    expect(redactCredentials({ denylist: [], source: false, text: once }).text).toBe(
      String.raw`{"content":"cat db.yml\n  password: [redacted:secret-config] \"[redacted:secret-quoted]\""}`,
    );
    const twice = String.raw`{"result":"{\\\"password\\\": \\\"TwiceEscapedPw9\\\"}"}`;
    expect(redactCredentials({ denylist: [], source: false, text: twice }).text).toBe(
      String.raw`{"result":"{\\\"password\\\": \\\"[redacted:secret-quoted]\\\"}"}`,
    );
  });

  it("masks a credential escaped three and four times, a transcript quoting a transcript", () => {
    let text = JSON.stringify({ password: "deepPw9" });
    for (let level = 0; level < 3; level += 1) {
      text = JSON.stringify({ content: text });
    }
    const masked = redactCredentials({ denylist: [], source: false, text }).text;
    expect(masked.includes("deepPw9")).toBe(false);
    expect(masked).toContain("[redacted:secret-quoted]");
  });

  it("leaves a page with no credential untouched and reports nothing", () => {
    const page = "<h1>Voice hosting</h1>\n<p>Lean A: keep the console voice.</p>\n";
    expect(redactCredentials({ denylist: [], source: false, text: page })).toEqual({ redactions: [], text: page });
  });
});
