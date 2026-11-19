# Changelog

All notable changes to everyhook are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.5.2] - 2026-11-19

- The release of two corrections made on main after 1.5.1, so that the newest release is the one whose real-binary checks are green on every system. The README and the 1.5.1 lines of this changelog now say that a project's Codex hooks always ran only in a trusted project, and that before Codex 0.169.0 a run with `sandbox_mode = "danger-full-access"` trusted the folder by itself (put to 0.166.0 and 0.168.0: the run wrote the entry, and the project's hooks then ran; in the default sandbox they did not), where 1.5.1 said the bypass flag had run them (a9eb5dd). The real-binary check of `--trust` reads the entry Codex writes on Linux and macOS, in double quotes, as well as the one on Windows, in single quotes; on 1.5.1 it failed on Ubuntu and macOS for that reason alone (d534ce4). The e2e of that tree is green on Ubuntu, macOS and Windows on codex-cli 0.170.0, Copilot CLI 1.0.114 and Gemini CLI 0.69.0 (runs 44504088083 and 44504079232).

## [1.5.1] - 2026-11-19

- `install --scope project` for Codex CLI now says that Codex loads a project's hooks only in a trusted project, and how to trust it: trust the folder when Codex asks, run `codex exec --trust` once in it (0.169.0 or later), or add `[projects.'<folder>'] trust_level = "trusted"` to `config.toml` in `CODEX_HOME`. The README, the conformance note and the "What still needs you" section say the same.
- Following Codex CLI 0.169.0 (openai/codex #60041, "Require explicit project trust in non-interactive runs"). Bisected with side-by-side installs: a project's hooks always ran only in a trusted project, but before 0.169.0 a `codex exec` run with `sandbox_mode = "danger-full-access"` trusted the folder by itself (it wrote the entry), so `--dangerously-bypass-hook-trust` ran the hooks of `.codex/hooks.json` there with no step of the person's (seen on 0.168.0); on 0.169.0 and 0.170.0 no run trusts a folder by itself, the hooks stay off, and Codex prints `Untrusted project-local configuration is disabled. Run codex exec --trust ...`. A trust entry in `config.toml`, or `codex exec --trust` (which writes it; it does not exist before 0.169.0), makes the project's hooks run again on 0.168.0, 0.169.0 and 0.170.0 (`--trust` only on the last two). A hook in the user's own `hooks.json` needs no project trust.
- Tests: the real-binary check of `--scope project` for Codex trusts the project with that entry (it had been red in `e2e.yml` since 16 November), and a new check puts an untrusted project and `--trust` to Codex 0.169.0 and later. 318 tests.

## [1.5.0] - 2026-10-28

- `list --ours`: only the entries everyhook wrote across the agents, leaving out files whose hooks are all non-everyhook. It combines with `--agent`, `--event`, `--hook`, `--problems` and `--project`; problems are counted on the entries shown, no match is a successful empty report, and `--json` adds `ours: true`. An argument with a value, or `--ours` twice, is a usage error.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#10](https://github.com/nrzz/everyhook/pull/10), for the good first issue [#9](https://github.com/nrzz/everyhook/issues/9).

## [1.4.0] - 2026-10-19

- `list --problems`: only the entries and files with a problem, leaving out everything that is fine. It combines with `--agent`, `--hook`, `--event` and `--project`; problems are counted on the entries and files shown, no match is a successful empty report, and `--json` adds `problems: true`. An argument with a value, or `--problems` twice, is a usage error.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#8](https://github.com/nrzz/everyhook/pull/8), for the good first issue [#7](https://github.com/nrzz/everyhook/issues/7).

## [1.3.0] - 2026-10-19

- `list --event <e,f,...>`: only the entries of those contract events (`pre-tool`, `post-tool`, `prompt`, `session-start`, `session-end`, `stop`, or `all`), across the agents, through each agent's own event names; an agent-only native event is left out, an unknown name is the usage error `install --event` gives. It combines with `--agent`, `--hook` and `--project`; files that keep no matching entry are left out, problems are counted on the entries shown, no match is a successful empty report, and `--json` adds `events` as given.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#6](https://github.com/nrzz/everyhook/pull/6), for the good first issue [#5](https://github.com/nrzz/everyhook/issues/5).

## [1.2.0] - 2026-10-19

- `list --hook <name>`: only the entries of one hook, across the agents: the entries `install` wrote for it and any other entry whose command line holds the name as a whole file name or path (`block-force-push.mjs` matches `.../examples/block-force-push.mjs`; `force` matches nothing), ignoring case on Windows and the direction of slashes. Files that keep no matching entry are left out, problems are counted on the entries shown, and no match is a successful empty report; `--json` adds `hook`. An empty name, or `--hook` twice, is a usage error.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#4](https://github.com/nrzz/everyhook/pull/4), for the good first issue [#3](https://github.com/nrzz/everyhook/issues/3).

## [1.1.0] - 2026-10-19

- Short agent names: `claude` (for `claude-code`), `gemini` (for `gemini-cli`) and `copilot` (for `copilot-cli`) are accepted in `--agent` and as the agent of `explain`, on `install`, `uninstall`, `restore`, `list`, `bench` and `run`. The long name wins when both could apply; every output, text and JSON, and every line `install` writes into a configuration file keep the long ids. An unknown name is the usage error it was.
- Contributed by [@Dasprakash-Sekar](https://github.com/Dasprakash-Sekar) in [#2](https://github.com/nrzz/everyhook/pull/2), the first outside pull request, for the good first issue [#1](https://github.com/nrzz/everyhook/issues/1).

## [1.0.0] - 2026-10-17

- First release. A CLI that lets one hook run in Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor. Node 18 or newer, no dependencies.
- The contract: a hook is any executable (`.mjs`, `.js`, `.cjs`, `.ps1`, `.sh`, `.cmd`, `.bat`, or anything else as it is). It reads one JSON document on stdin (`agent`, `event`, `tool` with its `kind`, `prompt`, `cwd`, `session`, `transcript`, `native`) and may print `{ decision, reason, message, context }`.
- `run` is the adapter the agents call. It reads the agent's JSON, runs the hook and answers in the agent's own JSON with exit code 0: the form that delivered the reason on all four recorded binaries, and the only one that blocks on Codex CLI for Windows. A hook that cannot start, runs too long or prints something that is not an answer is ignored with a message, or denied with `--fail-closed`.
- `install` puts the hook into each agent's configuration with that agent's event names, matcher syntax and timeout unit, by editing the file's text after a backup. `uninstall` takes exactly those entries out and gives the file back byte for byte. `restore` puts a backup back. All three take `--dry-run`.
- `list` shows every hook of every agent, from every file each agent reads, with the problems it would trip over.
- `bench` puts a hook to the documents the agents sent (53 recorded from Claude Code 2.1.302, Codex CLI 0.163.0, Gemini CLI 0.64.0 and Copilot CLI 1.0.98, and 11 written from Cursor's reference) and prints what each agent would do with the answer, with the exact JSON.
- `explain` is the table of how the five agents differ, every cell marked `binary` or `docs`, with the files each agent reads on Windows, macOS and Linux.
- Three example hooks: `block-force-push`, `protect-env-files` and `log-tool-calls`.
- What the agents do is what the real binaries did: 52 raw hook outputs, the adapter at every event, project scope, and the case where everyhook itself is gone. They ran on Windows 11 and, on every push, on GitHub's Windows, macOS and Linux runners (`e2e.yml`). Cursor was not run.
- Zero tokens for the tool. A hook costs nothing unless it returns a `reason` or a `context`; the longest reason of the examples is 140 characters.

[1.5.2]: https://github.com/nrzz/everyhook/releases/tag/v1.5.2
[1.5.1]: https://github.com/nrzz/everyhook/releases/tag/v1.5.1
[1.5.0]: https://github.com/nrzz/everyhook/releases/tag/v1.5.0
[1.4.0]: https://github.com/nrzz/everyhook/releases/tag/v1.4.0
[1.3.0]: https://github.com/nrzz/everyhook/releases/tag/v1.3.0
[1.2.0]: https://github.com/nrzz/everyhook/releases/tag/v1.2.0
[1.1.0]: https://github.com/nrzz/everyhook/releases/tag/v1.1.0
[1.0.0]: https://github.com/nrzz/everyhook/releases/tag/v1.0.0

[Unreleased]: https://github.com/nrzz/everyhook/compare/v1.5.2...HEAD
