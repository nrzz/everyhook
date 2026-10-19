// list: every hook of every agent from every file each one reads, and the problems it would trip over (a program that is not there, a
// timeout in the wrong unit, a misspelt event, a Copilot file with the wrong version, a Gemini hooks entry that is not an array, a Codex layer
// with hooks in both formats, a Claude file that Copilot also reads).
import { world, run, ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listHooks, matchesHook, missingProgram } from "../src/list.mjs";

const EXAMPLE = path.join(ROOT, "examples", "block-force-push.mjs");
const J = (o) => JSON.stringify(o, null, 2);
const node = `"${process.execPath.replace(/\\/g, "/")}"`;

const listJson = async (w, args = []) => (await run(["list", "--json", ...args], { w })).json();

test("nothing configured is said in one line, and is not a problem", async () => {
  const w = world("list");
  const r = await run(["list"], { w });
  assert.equal(r.code, 0);
  assert.equal(r.out, "no agent has a hooks file on this machine or in this project\n");
  const j = await listJson(w);
  assert.deepEqual(j.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
});

test("hooks of every agent are listed with their event, matcher, command and timeout; the ones everyhook wrote are marked", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--all", "--event", "pre-tool", "--matcher", "Bash"], { w });
  w.write(path.join(w.claude, "settings.json"), J({ ...w.readJson(path.join(w.claude, "settings.json")), hooks: { ...w.readJson(path.join(w.claude, "settings.json")).hooks, Stop: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  const j = await listJson(w);
  assert.equal(j.counts.entries, 6);
  assert.equal(j.counts.ours, 5);
  assert.equal(j.ok, true, JSON.stringify(j.entries.map((e) => e.problems)));
  const by = Object.fromEntries(j.entries.filter((e) => e.ours).map((e) => [e.agent, e]));
  assert.deepEqual(Object.keys(by), ["claude-code", "codex", "gemini-cli", "copilot-cli", "cursor"]);
  assert.deepEqual([by["claude-code"].event, by["claude-code"].contractEvent, by["claude-code"].matcher, by["claude-code"].timeout], ["PreToolUse", "pre-tool", "Bash", { value: 30, unit: "s", seconds: 30 }]);
  assert.deepEqual(by["gemini-cli"].timeout, { value: 30000, unit: "ms", seconds: 30 });
  assert.equal(by["copilot-cli"].matcher, "Bash");
  assert.equal(path.basename(by.cursor.hook), "block-force-push.mjs");
  const mine = j.entries.find((e) => !e.ours);
  assert.equal(mine.event, "Stop");
  const text = (await run(["list"], { w })).out;
  assert.match(text, /^claude-code\n  user  .*settings\.json\n    PreToolUse +matcher Bash +timeout 30 s +\[everyhook\]/m);
  assert.match(text, /6 hooks in 5 files, 5 by everyhook; 0 problems/);
});

test("the project's files are read too (--project), and so is a Claude project file", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--agent", "claude-code,cursor", "--scope", "project", "--project", w.work], { w });
  const j = await listJson(w, ["--project", w.work]);
  assert.deepEqual(j.entries.map((e) => [e.agent, e.scope]), [["claude-code", "project"], ["cursor", "project"]]);
  const none = await listJson(w, ["--project", path.join(w.base, "elsewhere")]);
  assert.equal(none.entries.length, 0);
});

test("a hook of Claude Code in the project's .claude/settings.json is run by Copilot CLI too, and list says so", async () => {
  const w = world("list");
  w.write(path.join(w.work, ".claude", "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { Stop: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w, ["--project", w.work]);
  const project = j.entries.find((e) => e.scope === "project");
  assert.deepEqual(project.alsoRunBy, ["copilot-cli"]);
  assert.ok(project.problems.some((p) => /Copilot CLI also reads this file and will run this hook/.test(p)));
  assert.deepEqual(j.entries.find((e) => e.scope === "user").alsoRunBy, [], "the user file is not read by Copilot CLI");
  assert.equal(j.entries.filter((e) => e.agent === "copilot-cli").length, 0, "listed once, under the agent whose file it is");
});

test("a program that is not there is a problem, for the command and for the script an interpreter is given", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [
    { type: "command", command: "definitely-not-a-program --x" },
    { type: "command", command: `${node} ${path.join(w.base, "gone.mjs").replace(/\\/g, "/")}` },
    { type: "command", command: path.join(w.base, "gone.sh") },
    { type: "command", command: `${node} -e 0` },
  ] }] } }));
  const j = await listJson(w);
  const problems = j.entries.map((e) => e.problems);
  assert.match(problems[0][0], /^the program is not on PATH: definitely-not-a-program$/);
  assert.match(problems[1][0], /^the script does not exist: /);
  assert.match(problems[2][0], /^the program does not exist: /);
  assert.deepEqual(problems[3], []);
  assert.equal(j.ok, false);
  assert.equal((await run(["list"], { w })).code, 1, "a problem is exit 1");
});

test("only simple commands are checked: pipes, variables, relative paths and shell words are left alone", () => {
  const ctx = { env: { PATH: "" }, platform: process.platform };
  for (const line of ["cd x && y", "a | b", "$HOME/hooks/x.sh", "~/x.sh", "./hooks/x.sh", "hooks\\x.cmd", "FOO=1 bar", "echo hi", "& 'C:\\x\\y.ps1'", "%USERPROFILE%\\x.cmd", "", null]) assert.equal(missingProgram(line, ctx), null, String(line));
  assert.match(missingProgram("nope-program", ctx), /not on PATH/);
});

test("an event name that the agent does not document is a problem, with the right spelling when it is a case slip", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { pretooluse: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }], Nonsense: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries[0].problems[0], /^pretooluse is not an event name Claude Code documents \(did you mean PreToolUse\? names are case sensitive\); it is ignored$/);
  assert.match(j.entries[1].problems[0], /^Nonsense is not an event name Claude Code documents; it is ignored$/);
});

test("a timeout in the wrong unit is a problem: 30 for Gemini CLI is 30 milliseconds, 30000 for the others is hours", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { BeforeTool: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 30 }] }] } }));
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 30000 }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries.find((e) => e.agent === "gemini-cli").problems[0], /timeout 30 is read as milliseconds by Gemini CLI: 30 ms; did you mean 30000\?/);
  assert.match(j.entries.find((e) => e.agent === "claude-code").problems[0], /timeout 30000 is read as seconds by Claude Code: more than an hour; did you mean 30\?/);
});

test("a Gemini hooks entry that is not an array is a problem of the file, with what Gemini CLI does about it", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { enabled: true, BeforeTool: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  const f = j.files.find((x) => x.agent === "gemini-cli");
  assert.deepEqual(f.problems, ['hooks.enabled is not an array (it is boolean): Gemini CLI prints "Invalid configuration" ("Expected array") for this file at every start']);
  assert.equal(j.entries.length, 1);
});

test("a Gemini hook of another type than command is a problem", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { BeforeTool: [{ hooks: [{ type: "http", url: "https://example.com" }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries[0].problems[0], /supports only hooks of type "command", not "http"/);
});

test("a Copilot hooks file with a version other than 1 is a problem (one with no version ran on the real binary, so it is not), and its folder is read as a whole", async () => {
  const w = world("list");
  w.write(path.join(w.copilot, "hooks", "a.json"), J({ version: 2, hooks: { preToolUse: [{ type: "command", bash: `${node} -e 0`, timeoutSec: 5 }] } }));
  w.write(path.join(w.copilot, "hooks", "b.json"), J({ version: 1, hooks: { postToolUse: [{ type: "command", powershell: `${node} -e 0` }] } }));
  w.write(path.join(w.copilot, "hooks", "c.json"), J({ hooks: { sessionStart: [{ type: "command", bash: `${node} -e 0` }] } }));
  w.write(path.join(w.copilot, "hooks", "notes.txt"), "not a hooks file");
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [path.basename(e.file), e.event]), [["a.json", "preToolUse"], ["b.json", "postToolUse"], ["c.json", "sessionStart"]]);
  assert.deepEqual(j.files.find((f) => path.basename(f.file) === "c.json").problems, []);
  const a = j.files.find((f) => path.basename(f.file) === "a.json");
  assert.match(a.problems[0], /^"version" is 2: Copilot CLI ignores a hook file whose version is not 1, without a word$/);
  assert.deepEqual(j.files.find((f) => path.basename(f.file) === "b.json").problems, []);
});

test("Codex: hooks in hooks.json and in config.toml of one layer are a problem for both files; the TOML hooks are listed", async () => {
  const w = world("list");
  w.write(path.join(w.codex, "hooks.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  w.write(path.join(w.codex, "config.toml"), `model = "gpt-5.5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = '${node} -e 0'\ntimeout = 5\n`);
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [path.basename(e.file), e.event]), [["hooks.json", "PreToolUse"], ["config.toml", "Stop"]]);
  for (const f of j.files.filter((x) => x.agent === "codex" && x.status === "found")) assert.match(f.problems.join(" "), /defines hooks in hooks\.json and in config\.toml: Codex merges them and warns at startup; keep one/, f.file);
  // one format alone is fine
  fs.rmSync(path.join(w.codex, "config.toml"));
  const one = await listJson(w);
  assert.equal(one.files.find((x) => x.agent === "codex" && x.status === "found").problems.length, 0);
});

test("a config.toml that is not TOML the reader knows is said, not guessed at", async () => {
  const w = world("list");
  w.write(path.join(w.codex, "config.toml"), "this is = = not toml\n");
  const j = await listJson(w);
  const f = j.files.find((x) => x.agent === "codex");
  assert.equal(f.status, "unreadable");
  assert.match(f.problems[0], /^config\.toml is not TOML this reader knows \(line 1: .*\); its hooks are not listed$/);
});

test("a file that is not JSON is a problem of the file, and the other files are still listed", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), "{ nope");
  w.write(path.join(w.cursor, "hooks.json"), J({ version: 1, hooks: { stop: [{ command: `${node} -e 0` }] } }));
  const j = await listJson(w);
  assert.equal(j.files.find((f) => f.agent === "claude-code").status, "unreadable");
  assert.match(j.files.find((f) => f.agent === "claude-code").problems[0], /^not valid JSON: .*; Claude Code cannot read it$/);
  assert.equal(j.entries.length, 1);
});

test("an everyhook entry whose everyhook or hook has gone is a problem", async () => {
  const w = world("list");
  const hook = path.join(w.hooks, "mine.mjs");
  fs.copyFileSync(EXAMPLE, hook);
  await run(["install", hook, "--agent", "claude-code"], { w });
  fs.rmSync(hook);
  const j = await listJson(w);
  assert.ok(j.entries[0].problems.some((p) => /^the hook does not exist: /.test(p)), JSON.stringify(j.entries[0].problems));
});

test("the administrators' files are read: managed settings, the system settings of Gemini, policy files of Copilot, enterprise hooks of Cursor", async () => {
  const w = world("list");
  const sys = path.join(w.home, ".no-system-files");
  w.write(path.join(sys, "claude", "managed-settings.json"), J({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  w.write(path.join(sys, "copilot", "policy.d", "10-audit.json"), J({ version: 1, hooks: { sessionStart: [{ type: "command", bash: `${node} -e 0` }] } }));
  w.write(path.join(sys, "cursor", "hooks.json"), J({ version: 1, hooks: { sessionStart: [{ command: `${node} -e 0` }] } }));
  w.write(path.join(sys, "gemini", "settings.json"), J({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [e.agent, e.scope]).sort(), [["claude-code", "managed"], ["copilot-cli", "managed"], ["cursor", "managed"], ["gemini-cli", "managed"]]);
});

test("--agent narrows the list", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--all"], { w });
  const j = await listJson(w, ["--agent", "codex,cursor"]);
  assert.deepEqual([...new Set(j.entries.map((e) => e.agent))], ["codex", "cursor"]);
  assert.equal(listHooks({ env: w.env, platform: process.platform, project: w.work, agents: ["gemini-cli"] }).entries.length, 1);
});

test("list --hook matches by file name, relative path, and entries install wrote", async () => {
  const w = world("list-hook");
  await run(["install", EXAMPLE, "--agent", "claude-code,codex"], { w });
  // Add a non-everyhook hook running block-force-push.mjs and another hook
  const settingsPath = path.join(w.claude, "settings.json");
  const settings = w.readJson(settingsPath);
  settings.hooks.SessionStart = [{ hooks: [{ type: "command", command: "bash /scripts/block-force-push.mjs" }] }];
  settings.hooks.Stop = [{ hooks: [{ type: "command", command: "python C:/tools/my-script.py" }] }];
  w.write(settingsPath, J(settings));

  // Match by file name
  const jName = await listJson(w, ["--hook", "block-force-push.mjs"]);
  assert.equal(jName.counts.entries, 3);
  assert.equal(jName.counts.ours, 2);
  assert.equal(jName.counts.files, 2);
  assert.equal(jName.hook, "block-force-push.mjs");
  assert.ok(jName.entries.every((e) => e.command.includes("block-force-push.mjs")));

  // Match by relative path as given
  const jPath = await listJson(w, ["--hook", "examples/block-force-push.mjs"]);
  assert.equal(jPath.counts.entries, 2);
  assert.equal(jPath.counts.ours, 2);
  assert.equal(jPath.counts.files, 2);
  assert.equal(jPath.hook, "examples/block-force-push.mjs");

  // Substring of file name matches nothing
  const jForce = await listJson(w, ["--hook", "force"]);
  assert.equal(jForce.counts.entries, 0);
  assert.equal(jForce.counts.files, 0);
  assert.equal(jForce.counts.ours, 0);
  assert.equal(jForce.counts.problems, 0);
  assert.deepEqual(jForce.entries, []);
  assert.deepEqual(jForce.files, []);
});

test("list --hook text output leaves out files with no matching entry, and empty match reports 0 hooks", async () => {
  const w = world("list-hook-text");
  await run(["install", EXAMPLE, "--agent", "claude-code,codex"], { w });

  // Matching text report
  const r = await run(["list", "--hook", "block-force-push.mjs"], { w });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("claude-code"));
  assert.ok(r.out.includes("codex"));
  assert.ok(!r.out.includes("gemini-cli"));
  assert.ok(!r.out.includes("copilot-cli"));
  assert.ok(!r.out.includes("cursor"));
  assert.match(r.out, /2 hooks in 2 files, 2 by everyhook; 0 problems/);

  // No match text report: exit 0, exactly 0 hooks in 0 files
  const empty = await run(["list", "--hook", "nonexistent.mjs"], { w });
  assert.equal(empty.code, 0);
  assert.equal(empty.out, "0 hooks in 0 files, 0 by everyhook; 0 problems\n");

  // No match JSON report: exit 0, hook preserved, files and entries empty
  const emptyJson = await listJson(w, ["--hook", "nonexistent.mjs"]);
  assert.equal(emptyJson.ok, true);
  assert.equal(emptyJson.hook, "nonexistent.mjs");
  assert.deepEqual(emptyJson.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
  assert.deepEqual(emptyJson.files, []);
  assert.deepEqual(emptyJson.entries, []);
});

test("list --hook handles Windows case folding and slash direction", () => {
  assert.equal(matchesHook({ command: "node C:/tools/block-force-push.mjs" }, "block-force-push.mjs", "win32"), true);
  assert.equal(matchesHook({ command: "node C:\\\\tools\\\\block-force-push.mjs" }, "block-force-push.mjs", "win32"), true);
  assert.equal(matchesHook({ command: "node C:/tools/block-force-push.mjs" }, "BLOCK-FORCE-PUSH.MJS", "win32"), true);
  assert.equal(matchesHook({ command: "node /tools/block-force-push.mjs" }, "BLOCK-FORCE-PUSH.MJS", "linux"), false);
  assert.equal(matchesHook({ command: "node /tools/block-force-push.mjs" }, "tools/block-force-push.mjs", "linux"), true);
  assert.equal(matchesHook({ command: "node /tools/block-force-push.mjs" }, "tools\\\\block-force-push.mjs", "linux"), true);
  assert.equal(matchesHook({ command: "node /tools/block-force-push.mjs" }, "force", "win32"), false);
  assert.equal(matchesHook({ hook: "/a/b/examples/block-force-push.mjs", command: "..." }, "examples/block-force-push.mjs", "linux"), true);
  assert.equal(matchesHook({ hook: "/a/b/examples/block-force-push.mjs", command: "..." }, "block-force-push.mjs", "linux"), true);
});

test("list --hook usage errors exit 2", async () => {
  const w = world("list-hook-errors");
  const missing = await run(["list", "--hook"], { w });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /--hook needs a value/);

  const empty = await run(["list", "--hook", ""], { w });
  assert.equal(empty.code, 2);
  assert.match(empty.err, /--hook needs a hook name/);

  const twice = await run(["list", "--hook", "a", "--hook", "b"], { w });
  assert.equal(twice.code, 2);
  assert.match(twice.err, /--hook can only be given once/);
});

test("list --event filters entries across agents, supports all, combinations with --agent and --hook, and ignores agent-only native events", async () => {
  const w = world("list-event");
  await run(["install", EXAMPLE, "--agent", "claude-code,codex", "--event", "pre-tool,stop"], { w });

  // Add an agent-only native event by hand (Notification is documented for Claude Code, but has no contract event)
  const settingsPath = path.join(w.claude, "settings.json");
  const settings = w.readJson(settingsPath);
  settings.hooks.Notification = [{ hooks: [{ type: "command", command: `${node} -e 0` }] }];
  w.write(settingsPath, J(settings));

  // Single event filter
  const jPre = await listJson(w, ["--event", "pre-tool"]);
  assert.equal(jPre.ok, true);
  assert.deepEqual(jPre.events, ["pre-tool"]);
  assert.equal(jPre.counts.entries, 2);
  assert.equal(jPre.counts.ours, 2);
  assert.equal(jPre.counts.files, 2);
  assert.ok(jPre.entries.every((e) => e.contractEvent === "pre-tool"));

  // Combination with --agent
  const jAgent = await listJson(w, ["--event", "stop,session-end", "--agent", "claude,codex"]);
  assert.deepEqual(jAgent.events, ["stop", "session-end"]);
  assert.equal(jAgent.counts.entries, 2);
  assert.deepEqual(jAgent.entries.map((e) => [e.agent, e.contractEvent]), [["claude-code", "stop"], ["codex", "stop"]]);

  // Combination with --hook
  const jHook = await listJson(w, ["--event", "pre-tool", "--hook", "block-force-push.mjs"]);
  assert.deepEqual(jHook.events, ["pre-tool"]);
  assert.equal(jHook.hook, "block-force-push.mjs");
  assert.equal(jHook.counts.entries, 2);

  // --event all expands to all contract events; agent-only native event (Notification) is left out
  const jAll = await listJson(w, ["--event", "all"]);
  assert.equal(jAll.ok, true);
  assert.deepEqual(jAll.events, ["pre-tool", "post-tool", "prompt", "session-start", "session-end", "stop"]);
  assert.equal(jAll.counts.entries, 4);
  assert.ok(!jAll.entries.some((e) => e.event === "Notification"));
});

test("list --event text output leaves out files with no matching entry, and empty match reports 0 hooks", async () => {
  const w = world("list-event-text");
  await run(["install", EXAMPLE, "--agent", "claude-code,codex", "--event", "pre-tool"], { w });

  // Matching text report
  const r = await run(["list", "--event", "pre-tool"], { w });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("claude-code"));
  assert.ok(r.out.includes("codex"));
  assert.ok(r.out.includes("PreToolUse"));
  assert.match(r.out, /2 hooks in 2 files, 2 by everyhook; 0 problems/);

  // No match text report: exit 0, exactly 0 hooks in 0 files
  const empty = await run(["list", "--event", "stop"], { w });
  assert.equal(empty.code, 0);
  assert.equal(empty.out, "0 hooks in 0 files, 0 by everyhook; 0 problems\n");

  // No match JSON report: exit 0, events preserved, files and entries empty
  const emptyJson = await listJson(w, ["--event", "stop"]);
  assert.equal(emptyJson.ok, true);
  assert.deepEqual(emptyJson.events, ["stop"]);
  assert.deepEqual(emptyJson.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
  assert.deepEqual(emptyJson.files, []);
  assert.deepEqual(emptyJson.entries, []);
});

test("list --event unknown name exits 2", async () => {
  const w = world("list-event-errors");
  const unknown = await run(["list", "--event", "not-an-event"], { w });
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown event "not-an-event"/);

  const missing = await run(["list", "--event"], { w });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /--event needs a value/);
});

test("list --problems keeps only entries and files with problems (text and JSON)", async () => {
  const w = world("list-problems");
  // One good entry (fine, should be left out)
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  // Three kinds of problems:
  // 1. A misspelt event
  w.write(path.join(w.codex, "hooks.json"), J({ hooks: { Pretool: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  // 2. A missing program
  w.write(path.join(w.copilot, "hooks", "bad-prog.json"), J({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "/path/to/nonexistent/program-xyz" }] } }));
  // 3. A file of the wrong shape
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: [] }));

  // Without --problems: all 4 files found, 3 entries, 3 problems
  const full = await listJson(w);
  assert.equal(full.counts.entries, 3);
  assert.equal(full.counts.files, 4);
  assert.equal(full.counts.problems, 3);
  assert.equal(full.problems, undefined);

  // With --problems (JSON): only the 2 problem entries and 3 problem files kept
  const j = await listJson(w, ["--problems"]);
  assert.equal(j.ok, false);
  assert.equal(j.problems, true);
  assert.equal(j.counts.entries, 2);
  assert.equal(j.counts.files, 3);
  assert.equal(j.counts.problems, 3);
  assert.deepEqual(j.entries.map((e) => e.agent).sort(), ["codex", "copilot-cli"]);
  assert.deepEqual(j.files.map((f) => f.agent).sort(), ["codex", "copilot-cli", "gemini-cli"]);
  assert.match(j.entries[0].problems[0], /Pretool is not an event/);
  assert.match(j.entries[1].problems[0], /the program does not exist/);
  assert.match(j.files.find((f) => f.agent === "gemini-cli").problems[0], /"hooks" is not an object/);

  // With --problems (text): exit 1, fine agent left out, closing line counts shown items
  const r = await run(["list", "--problems"], { w });
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes("claude-code"), "fine agent is omitted");
  assert.ok(r.out.includes("codex"));
  assert.ok(r.out.includes("copilot-cli"));
  assert.ok(r.out.includes("gemini-cli"));
  assert.match(r.out, /2 hooks in 3 files, 0 by everyhook; 3 problems/);
});

test("list --problems combines with --agent and --hook", async () => {
  const w = world("list-problems-combo");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  w.write(path.join(w.codex, "hooks.json"), J({ hooks: { Pretool: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  w.write(path.join(w.copilot, "hooks", "bad-prog.json"), J({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "/path/to/nonexistent/program-xyz" }] } }));
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: [] }));

  // Combined with --agent
  const jAgent = await listJson(w, ["--problems", "--agent", "codex"]);
  assert.equal(jAgent.ok, false);
  assert.equal(jAgent.problems, true);
  assert.equal(jAgent.counts.entries, 1);
  assert.equal(jAgent.counts.files, 1);
  assert.equal(jAgent.counts.problems, 1);
  assert.equal(jAgent.entries[0].agent, "codex");

  // Combined with --hook
  const jHook = await listJson(w, ["--problems", "--hook", "program-xyz"]);
  assert.equal(jHook.ok, false);
  assert.equal(jHook.problems, true);
  assert.equal(jHook.counts.entries, 1);
  assert.equal(jHook.counts.files, 1);
  assert.equal(jHook.counts.problems, 1);
  assert.equal(jHook.entries[0].agent, "copilot-cli");
});

test("list --problems with no problems reports 0 hooks in 0 files and exits 0", async () => {
  const w = world("list-problems-clean");
  await run(["install", EXAMPLE, "--agent", "claude-code"], { w });

  // Text report
  const emptyText = await run(["list", "--problems"], { w });
  assert.equal(emptyText.code, 0);
  assert.equal(emptyText.out, "0 hooks in 0 files, 0 by everyhook; 0 problems\n");

  // JSON report
  const emptyJson = await listJson(w, ["--problems"]);
  assert.equal(emptyJson.ok, true);
  assert.equal(emptyJson.problems, true);
  assert.deepEqual(emptyJson.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
  assert.deepEqual(emptyJson.files, []);
  assert.deepEqual(emptyJson.entries, []);
});

test("list --problems usage errors: with value or twice exits 2", async () => {
  const w = world("list-problems-errors");
  const val = await run(["list", "--problems=yes"], { w });
  assert.equal(val.code, 2);
  assert.match(val.err, /--problems takes no value/);

  const dup = await run(["list", "--problems", "--problems"], { w });
  assert.equal(dup.code, 2);
  assert.match(dup.err, /--problems can only be given once/);

  const wrongCmd = await run(["install", EXAMPLE, "--problems"], { w });
  assert.equal(wrongCmd.code, 2);
  assert.match(wrongCmd.err, /install does not take --problems/);
});

test("list --ours: shows only entries written by everyhook and omits files with no matching entries", async () => {
  const w = world("list-ours");
  await run(["install", EXAMPLE, "--agent", "claude-code"], { w });
  // Add hand-written entry to claude's file
  w.write(path.join(w.claude, "settings.json"), J({ ...w.readJson(path.join(w.claude, "settings.json")), hooks: { ...w.readJson(path.join(w.claude, "settings.json")).hooks, Stop: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  // Add hand-written entry in codex
  w.write(path.join(w.codex, "hooks.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));

  // Without --ours: 3 entries in 2 files, 1 by everyhook
  const full = await listJson(w);
  assert.equal(full.counts.entries, 3);
  assert.equal(full.counts.files, 2);
  assert.equal(full.counts.ours, 1);
  assert.equal(full.ours, undefined);

  // With --ours (JSON): only the 1 everyhook entry and 1 everyhook file kept
  const j = await listJson(w, ["--ours"]);
  assert.equal(j.ok, true);
  assert.equal(j.ours, true);
  assert.equal(j.counts.entries, 1);
  assert.equal(j.counts.files, 1);
  assert.equal(j.counts.ours, 1);
  assert.equal(j.counts.problems, 0);
  assert.equal(j.entries.length, 1);
  assert.equal(j.entries[0].ours, true);
  assert.equal(j.entries[0].agent, "claude-code");
  assert.equal(j.files.length, 1);
  assert.equal(j.files[0].agent, "claude-code");

  // With --ours (text): exit 0, codex left out because it has no everyhook hooks, hand-written Stop left out
  const r = await run(["list", "--ours"], { w });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("claude-code"));
  assert.ok(!r.out.includes("codex"), "codex file has only non-everyhook hooks so it drops out");
  assert.ok(!r.out.includes("Stop"), "hand-written entry drops out");
  assert.match(r.out, /1 hook in 1 file, 1 by everyhook; 0 problems/);
});

test("list --ours combines with --agent, --event, --problems, and --project", async () => {
  const w = world("list-ours-combo");
  await run(["install", EXAMPLE, "--agent", "claude-code,gemini-cli"], { w });
  await run(["install", EXAMPLE, "--agent", "cursor", "--scope", "project", "--project", w.work], { w });
  // Make the hook file in gemini point to a nonexistent file so it has a problem
  const geminiSettings = w.readJson(path.join(w.gemini, "settings.json"));
  geminiSettings.hooks.BeforeTool[0].hooks[0].command = geminiSettings.hooks.BeforeTool[0].hooks[0].command.replace("block-force-push.mjs", "nonexistent-hook.mjs");
  w.write(path.join(w.gemini, "settings.json"), J(geminiSettings));

  // Combined with --agent
  const jAgent = await listJson(w, ["--ours", "--agent", "claude-code"]);
  assert.equal(jAgent.ok, true);
  assert.equal(jAgent.ours, true);
  assert.equal(jAgent.counts.entries, 1);
  assert.equal(jAgent.counts.files, 1);
  assert.equal(jAgent.entries[0].agent, "claude-code");

  // Combined with --event
  const jEvent = await listJson(w, ["--ours", "--event", "pre-tool", "--project", w.work]);
  assert.equal(jEvent.ours, true);
  assert.equal(jEvent.counts.entries, 3);
  assert.equal(jEvent.counts.files, 3);

  // Combined with --problems: exit 1, only gemini has problem
  const jProblems = await listJson(w, ["--ours", "--problems"]);
  assert.equal(jProblems.ok, false);
  assert.equal(jProblems.ours, true);
  assert.equal(jProblems.problems, true);
  assert.equal(jProblems.counts.entries, 1);
  assert.equal(jProblems.counts.files, 1);
  assert.equal(jProblems.entries[0].agent, "gemini-cli");
  assert.match(jProblems.entries[0].problems[0], /the hook does not exist/);

  const rProblems = await run(["list", "--ours", "--problems"], { w });
  assert.equal(rProblems.code, 1);
  assert.ok(rProblems.out.includes("gemini-cli"));
  assert.ok(!rProblems.out.includes("claude-code"));
  assert.match(rProblems.out, /1 hook in 1 file, 1 by everyhook; 1 problem/);

  // Combined with --project
  const jProject = await listJson(w, ["--ours", "--project", w.work]);
  assert.equal(jProject.counts.entries, 3);
  const projectScope = jProject.entries.find((e) => e.scope === "project");
  assert.equal(projectScope.agent, "cursor");
});

test("list --ours with no ours hooks reports 0 hooks in 0 files and exits 0", async () => {
  const w = world("list-ours-clean");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));

  // Text report
  const emptyText = await run(["list", "--ours"], { w });
  assert.equal(emptyText.code, 0);
  assert.equal(emptyText.out, "0 hooks in 0 files, 0 by everyhook; 0 problems\n");

  // JSON report
  const emptyJson = await listJson(w, ["--ours"]);
  assert.equal(emptyJson.ok, true);
  assert.equal(emptyJson.ours, true);
  assert.deepEqual(emptyJson.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
  assert.deepEqual(emptyJson.files, []);
  assert.deepEqual(emptyJson.entries, []);
});

test("list --ours usage errors: with value or twice exits 2", async () => {
  const w = world("list-ours-errors");
  const val = await run(["list", "--ours=yes"], { w });
  assert.equal(val.code, 2);
  assert.match(val.err, /--ours takes no value/);

  const dup = await run(["list", "--ours", "--ours"], { w });
  assert.equal(dup.code, 2);
  assert.match(dup.err, /--ours can only be given once/);

  const wrongCmd = await run(["install", EXAMPLE, "--ours"], { w });
  assert.equal(wrongCmd.code, 2);
  assert.match(wrongCmd.err, /install does not take --ours/);
});


