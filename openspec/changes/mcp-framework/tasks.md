---
schema_version: '1.0'
created:
  date: '2026-11-23T22:51:53.120Z'
  user: boonek
  agent:
    name: claude-code
    version: unknown
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~70d2b880-f0cc-4455-bf39-69366847a19c
  summary: >-
    Implementation tasks for mcp-framework, tests and docs per group, release
    last
updated:
  - date: '2026-11-24T15:11:33.226Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~3d33f0d5-21dc-4cb4-a45b-87cd381b62aa
    summary: '14.6 done: both reviews reconciled and addressed'
  - date: '2026-11-24T14:29:41.670Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~96807055-c79b-4c7e-985c-4481dd31a909
    summary: '14.3 done: names kept, details removed, frontmatter kept'
  - date: '2026-11-24T08:23:21.264Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~9e7343b6-3205-4e29-8416-e3780929ded3
    summary: >-
      Groups 1 to 3 complete; Tasks 4.1-4.6 and 5.1-5.3 done; Group 5 and 6
      complete; Group 7 complete, task 4.7 done; Groups 8 and 9 complete; Group
      10 complete; Group 11 complete; test script note; Group 12 complete; Group
      13 complete; Tasks 14.1, 14.2, 14.4, 14.5 done
  - date: '2026-11-24T00:05:01.422Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~94b68a64-4b39-4688-8736-46e881d11b48
    summary: 'Task 1.4 settled: Apache-2.0'
change_request: mcp-framework
---
# Tasks

Each group lands its own tests and documentation. Documentation tasks write the group's section of the
README, whose final assembly is group 13. The release tasks are the last group.

## 1. Project setup

- [x] 1.1 Fetch `origin/main`, fast-forward, and create the implementation branch; verify `git status -sb` shows the new branch based on the latest `main`
- [x] 1.2 Propose the initial version (suggested `0.1.0`) and wait for the user's confirmation before writing it; verify the user confirmed the number
- [x] 1.3 Create `package.json`: name `@audaciousinquiry/mcp-framework`, CommonJS, `engines.node` `>=22`, `files` `src/`, `README.md`, `LICENSE`, scripts `test` (`node --test "test/*.test.js"`, because a bare `node --test` also runs the files under `test/` that are fixtures), dependencies SDK `^1.32` and `log4js` `^6.9`, peer dependency `zod` `^4.4` (also a dev dependency); verify `npm install` succeeds
- [x] 1.4 Add `LICENSE` with the Apache License 2.0 text (decided 2026-11-23, consistent with prompt-url and the IZ Gateway Java repos); set `"license": "Apache-2.0"` in `package.json`; verify the file and `package.json` match
- [x] 1.5 Run `npm audit fix` after the install; verify `npm audit --audit-level=high` reports no high or critical finding
- [x] 1.6 Add a trivial `test/smoke.test.js` and `.github/workflows/test.yml` (push, pull request and `workflow_call`; `ubuntu-latest`; Node 22 and 24; `npm ci`, `npm audit fix`, `npm audit --audit-level=high`, `npm test`); verify both jobs pass on GitHub
- [x] 1.7 Create a `README.md` skeleton with the section headings from design 11.4; verify the headings are present in that order

## 2. Small utilities

- [x] 2.1 Write the version compare (major, minor, patch; suffixes ignored); verify unit tests for equal, older, newer and `1.2.3-beta.1+build5` pass
- [x] 2.2 Write the configuration merge (nested objects key by key, arrays replaced, `0`, `false` and `null` kept, unknown keys kept); verify unit tests for each rule pass
- [x] 2.3 Write name and version validation from `package.json` (usable as a directory name, derives the `<NAME>_LOG_LEVEL` variable name, version is semver); verify unit tests for the valid and each invalid case pass, with messages naming the field
- [x] 2.4 Write the Node version check (below 22 prints one line with the needed and found versions and exits non-zero); verify unit tests with injected versions 20 and 22 pass

## 3. Configuration

- [x] 3.1 Create the data directory `~/.mcp/<name>/` with its `logs` folder on demand; verify a test with `HOME` and `USERPROFILE` pointed at a temporary folder creates it and two MCP names never share one
- [x] 3.2 Require the declared default port and use it unless the file sets another; verify tests for the declared default, the user override and the refusal to start without a port
- [x] 3.3 Load the configuration: merge over defaults, keep unknown keys, reject invalid JSON or a port outside 1 to 65535 with a message naming the file and the problem, and never overwrite a corrupt file; verify tests for each case, including that the corrupt file's bytes are unchanged
- [x] 3.4 Write the defaults on first run from the launcher side only, with the exclusive-create flag and `EEXIST` read as success; the server uses the defaults in memory and writes nothing; verify tests for two simultaneous creators and for a server that finds no file
- [x] 3.5 Write the save function: no argument stores the current configuration; an update is merged into a copy, validated, written and only then applied in memory; replace the file by temporary file and rename; support the MCP's validate and normalize function; verify tests for partial update, zero as a value, normalization, rejection changing nothing in memory or on disk, and a failed write leaving the old file complete
- [x] 3.6 Document the configuration file in the README (location, settings, first run, the changed-default caveat, the save function); verify every setting and path named in the section exists in the code

## 4. Logging

- [x] 4.1 Write the logging module, the only importer of `log4js`: `server.log` in the `logs` folder, daily and 10 MB roll-over, 7 old files, lines with timestamp, level, category and message, and a fallback to standard error when the folder is not writable; verify tests for the line format, a size roll-over with a lowered limit, and the unwritable folder
- [x] 4.2 Resolve the level in the order launcher option, environment variable, `log_level`, default `info`, with a clear error for an invalid value; verify unit tests for every precedence pair and the error text
- [x] 4.3 Apply the same level and file in worker threads from the same environment and file; verify a test where a worker thread logs at `debug` and the line appears
- [x] 4.4 Provide named loggers for the plugin; verify a test that a logger named `indexer` writes a line with category `indexer` to the same file
- [x] 4.5 Install handlers for uncaught exceptions and unhandled rejections in the launcher, the server and the bridge that write the stack trace and exit non-zero; verify a test where a timer callback throws in a child process and the trace is written
- [x] 4.6 Add the debug mirror to standard error, ignoring errors writing to it; verify one test that lines reach a connected standard error and one that the server keeps running and logging when standard error is closed mid-run
- [x] 4.7 Document logging in the README (levels, precedence, `--log-level`, rotation, the debug mirror); verify the commands shown run and behave as described

## 5. Tool declaration and registration

- [x] 5.1 Write `defineTools` (name, description and a Zod input schema, validated); verify unit tests for valid and each invalid declaration
- [x] 5.2 Write the schema conversion with `z.toJSONSchema` keeping `x-cli` markers; verify a unit test that `x-cli: 'file'` survives into the JSON Schema
- [x] 5.3 Write `register(server, tools, handlers)` and the result helpers: every handler wrapped so an exception becomes an error result with the stack logged, with start, duration and outcome logged; verify tests for a throwing handler, the timing lines, and a schema violation leaving the handler unrun
- [x] 5.4 Document writing tools in the README (`defineTools`, `register`, result helpers, errors as results); verify the section's example matches the fixture's `tools.js` once group 6 creates it

## 6. Server base class and HTTP

- [x] 6.1 Write `McpServerBase` with `run()` and the order startup, bind, process id file, after-listening, and create the stand-in MCP's `server.js` and `tools.js` in `test/fixtures/example-mcp/`; verify a startup that throws logs the stack, does not bind, writes no process id file and exits non-zero
- [x] 6.2 Serve on `127.0.0.1` only with `POST /` for MCP, `GET /health`, `POST /shutdown`, 404 for other routes and 405 for `GET` and `DELETE` on `/`; verify tests for each route and that the non-loopback address is refused
- [x] 6.3 Handle MCP requests statelessly with a fresh SDK server and transport per request, calling `registerTools` each time; verify tests for a call after a restart with no new handshake, concurrent clients, no session header, a registration failure giving 500 with the server still running, and malformed JSON
- [x] 6.4 Refuse requests carrying an `Origin` header (including preflights, with no CORS headers) and requests with a `Host` other than loopback on the server's port, and reject bodies over `maxBodyBytes` (default 1 MB) with 413 naming the setting; verify tests for a loopback `Origin`, a rebinding `Host`, a body one byte under and over the limit, and an override
- [x] 6.5 Write the health endpoint with `status`, `version`, `pid` and whole-number `uptime_seconds`, the plugin extension merged without overwriting base fields, and a failing extension still answering 200; verify a test for each
- [x] 6.6 Identify a port occupant by the shape of its `/health` (exit 0 quietly if it has the base fields, report and exit non-zero otherwise, non-bind errors exit non-zero); verify tests with a dummy server on the port
- [x] 6.7 Write the process id file after the bind, remove it at shutdown, and remove a stale one at start; verify tests for each
- [x] 6.8 Write the graceful shutdown (SIGTERM, SIGINT and `POST /shutdown`; stop accepting, drain for `drainMs` default 10 s, destroy the rest, run the `shutdown` method, remove the process id file, exit 0, ignore a second trigger); verify tests for an in-flight request finishing, one outlasting the drain, the hook completing before exit, and a repeated trigger
- [x] 6.9 Handle a failure in `afterListening` (log the stack and shut down cleanly with a non-zero status) and keep slow setup there from blocking health; verify a test for each
- [x] 6.10 Document the server class in the README (each overridable method and when it runs, health fields, shutdown, slow setup, the Origin rule and the body limit); verify the method names match the class

## 7. Launcher: start, replace, stop

- [x] 7.1 Write `runLauncher(definition)` with the Node check first, definition validation (default port required, `serverScript` defaulting to `server.js`, `nodeArgs`, `startupTimeoutMs`) and the fixture's `index.js`; verify tests for each validation message including the missing server file
- [x] 7.2 Write the health probe: `127.0.0.1`, 5 s timeout, no retries, distinguishing a body, a refused connection and a silent connection; verify tests including a server that accepts and never answers
- [x] 7.3 Write the start: remove a stale process id file, detached `spawn` of `process.execPath` with `nodeArgs` first, stdout ignored, stderr inherited and `unref`, then wait for the child exiting, the process id file appearing (then one probe) or the timeout (then a final check and a report naming the pid and log file, leaving the server running, exit non-zero); verify tests for a normal start, a premature exit reporting the code, and a timeout leaving the process alive
- [x] 7.4 Write the version-aware start: same version reports already running and exits 0, older is stopped and replaced, newer is refused with or without restart and tells the user to stop it first; verify tests using two fixture versions
- [x] 7.5 Write the stop: `POST /shutdown` within 5 s, wait up to 30 s, then terminate and force-kill after 15 s, wait up to 5 s for the port to free, remove the process id file, report graceful or killed; verify tests for the graceful path, the fallback with a server that ignores `/shutdown`, and an immediate restart not hitting a port in use
- [x] 7.6 Add `--stop`, `--restart` (also when nothing runs), the unresponsive-server report (refused starts a server and removes a stale file; silent reports the pid and exits non-zero without killing), `--debug`, and `--log-level` passed to the server it starts with a not-applied message for a running one; verify a test for each
- [x] 7.7 Write the respawn function for the bridge (the same start path, no console messages, safe for several callers by the port bind); verify a test where several callers respawn at once and one server results
- [x] 7.8 Document the launcher in the README (definition fields, run, stop, restart, debug, troubleshooting a port in use, a server that will not start and a stale file, the standard-error pipe caveat, `/shutdown` on Windows); verify every command shown runs against the fixture

## 8. Argument mapping

- [x] 8.1 Write the argument parser (`--name value`, `--name=value`, `--no-name`, negative values such as `--since -7d`, repeated flags); verify unit tests including the cases `util.parseArgs` rejects
- [x] 8.2 Convert by the schema's types, never by guessing, with untyped properties as strings; verify unit tests for `007` staying a string and `7` becoming a number
- [x] 8.3 Convert integers, numbers, booleans and enums with errors naming the setting and the value; verify unit tests for each type and each error
- [x] 8.4 Handle quoting and escaping in strings, comma-separated arrays and fields that may be a string or a list; verify unit tests for quotes, escaped commas and both field forms
- [x] 8.5 Handle dotted names for nested fields and the merge order (JSON first, flags on top); verify unit tests for nested typing and the order
- [x] 8.6 Convert absolute and relative dates and date-times; verify unit tests with a fixed clock for each form and each failure
- [x] 8.7 Handle file path arguments (`x-cli: file`, resolved against the current directory) and the `@` prefix; verify unit tests including a missing file
- [x] 8.8 Fail fast on unknown, repeated or conflicting arguments with a suggestion for a near miss, honoring a schema that allows additional properties; verify unit tests and that nothing is sent to a server
- [x] 8.9 Print argument help for a tool (`call <tool> --help`) from the shared file, with no server; verify a test with nothing listening
- [x] 8.10 Document argument mapping in the README with an example for every type, dotted names, the `@` prefix, file paths and quoting in both cmd.exe and a POSIX shell; verify a test runs each documented example against the fixture

## 9. Command-line client

- [x] 9.1 Write `health` (indented JSON, an unhealthy answer reported with a non-zero exit, a short wait when unreachable, no server started); verify tests for each
- [x] 9.2 Write `list` from the shared tools file (name, description, parameters with type display for enums, arrays and objects, required marks), working with no server and not showing run-time tools; verify tests for each
- [x] 9.3 Write `call` (inline JSON, `@file`, flags, text to standard output, an error result to standard error with a non-zero exit, non-text content, missing or unknown tool, JSON-only for a run-time tool); verify tests against the fixture server
- [x] 9.4 Report user errors as one line prefixed with the MCP's name and unexpected failures with the stack; verify a test for each
- [x] 9.5 Support the plugin's default-arguments function with the user's value winning; verify tests for filling, not overwriting and absence
- [x] 9.6 Write `--help` and `-h` (framework options and commands including `init`, the configuration location, the default port and the plugin's option help); verify tests that each item appears
- [x] 9.7 Document the command line in the README; verify each command shown runs against the fixture

## 10. The init command

- [x] 10.1 Write `init [json|@file] [arguments]` typed from the settings Zod schema (and from the default's type when none is declared), working without a server, saving through the save function, with unknown settings suggested and nothing saved on error; verify tests for JSON, arguments, both together, nested settings, unknown and wrong-type settings
- [x] 10.2 Write the prompts (`readline/promises`) for settings declared promptable, Enter keeping the value and an invalid answer saving nothing; verify tests with piped standard input
- [x] 10.3 Print the resulting configuration and how to start and register the server over stdio and HTTP, and write `init --help`; verify tests for the output
- [x] 10.4 Document `init` in the README; verify the examples run against the fixture

## 11. The stdio bridge

- [x] 11.1 Write bridge mode (`--stdio`): make sure a server runs by the launcher's start path and on failure write the reason to standard error, exit non-zero and write nothing to standard output; verify tests for a start, an already-running server and a failed start
- [x] 11.2 Forward every message with the SDK's HTTP client transport and stdio server transport, including server-initiated messages and several clients at once; verify tests with a real SDK client through a spawned bridge
- [x] 11.3 Redirect `console.log`, `console.info` and `console.debug` to standard error in bridge mode; verify a test where a start-up hook calls `console.log` and standard output stays clean
- [x] 11.4 Exit with status zero when standard input closes, without stopping the server; verify a test that the server is still running afterwards
- [x] 11.5 Write the recovery: a failed forward at the connection level gets an error response with the request id and starts one guarded respawn, requests during it get the same immediate error, notifications are only logged, and a timeout or an HTTP error status does not restart the server; verify tests for an idle crash (first call errors, next succeeds), a crash in flight, a busy server, a 500, several bridges recovering together, and a failed recovery closing the bridge non-zero
- [x] 11.6 Write the start-up hook with `ctx`, run once the server is healthy before forwarding and again after each respawn, with a failure logged and the bridge still starting; verify tests for each
- [x] 11.7 Document the bridge in the README (registering over stdio, the recovery behavior including the error on the first call after an idle crash); verify the registration example works with a real client

## 12. The plugin contract

- [x] 12.1 Provide `ctx` (`config`, `client`, `log`) to every launcher hook and `this.config` and `this.log` in the server; verify tests that each is present and that `ctx.client` can call a tool
- [x] 12.2 Support extra launcher options with help text and handlers and fail at start-up on a name the framework reserves; verify tests for an added option, its help line and a collision
- [x] 12.3 Export `runLauncher`, `McpServerBase`, `defineTools`, `register` and the result helpers from the package entry; verify a test loads them from CommonJS and from an ES module
- [x] 12.4 Document the public contract and the semver policy in the README, listing the items from the plugin-contract spec; verify each listed item exists in the code
- [x] 12.5 Check that the fixture's three files support every mode (`--stdio`, `--stop`, `--restart`, `--debug`, `--help`, `health`, `list`, `call`, `init`); verify one test runs each mode

## 13. The README integration guide

- [x] 13.1 Assemble the README in the order of design 11.4 from the sections written earlier, with the example code blocks generated from the fixture's files; verify a test that every example block equals the corresponding fixture file
- [x] 13.2 Create `doc/index.md` as the documentation entry point linking the README and the design; verify the links resolve

## 14. Integration checks

- [x] 14.1 Pack the package with `npm pack`, install the tarball in a temporary empty folder, follow the README's steps to start the example, call a tool over HTTP with a real SDK client and over the stdio bridge, then stop it; verify the whole run passes as a test
- [x] 14.2 Run `npm pack --dry-run`; verify the file list is `src/`, `README.md`, `LICENSE` and `package.json` only
- [x] 14.3 Search the repository for credentials and for names of private projects; verify nothing is found
- [x] 14.4 Run `openspec validate mcp-framework` and review that every spec scenario is covered by a test or by the release checklist; verify validation passes and list any uncovered scenario for the user
- [x] 14.5 Run `npm audit --audit-level=high`; verify it is clean and CI is green on Node 22 and 24
- [x] 14.6 Open the pull request, tag Copilot for review first, then run `/review` on the diff without reading Copilot's comments, present the findings, and reconcile when Copilot's review lands; verify the findings are addressed and the user has adjudicated any disagreement

## 15. Release

- [ ] 15.1 Write `RELEASING.md` with the four checks from design 10.5; verify each item says what it proves and how to check it
- [ ] 15.2 Write `.github/workflows/publish.yml` (tag `vX.Y.Z`, calls `test.yml`, OIDC trusted publishing with `id-token: write`, `npm publish --access public --provenance`, and a step that fails when the tag's version differs from `package.json`); verify the version-check step with a matching and a mismatching version
- [ ] 15.3 The user adds the trusted publisher on npmjs.com (organization `@audaciousinquiry`, GitHub, owner `AudaciousInquiry`, repository `mcp-framework`, workflow `.github/workflows/publish.yml`); verify the user confirms it is saved
- [ ] 15.4 Run the release checklist: `npm test` on the user's Windows machine, the debug mirror appearing in a real terminal window, the fixture registered with a real client over stdio and over HTTP answering a tool call, and the README's steps followed in a clean folder; verify the user signs off each item
- [ ] 15.5 Confirm the release version with the user, tag it and push the tag; verify the publish workflow succeeds and `npm view @audaciousinquiry/mcp-framework version` shows the version

## Workflow follow-up

- Archive the change with `openspec archive mcp-framework -y` after the release, so the specs are promoted.
- Eclipse: `.project` already exists in the repository; if the project is not open, use File, Import, Existing Projects into Workspace.
- Migration is a separate change request. The proposed first MCP is ecfr-mcp. Revisit the bridge retry (design 7.1) once a real MCP runs on the framework.
- Update the projects-in-progress entry when `tasks.md` is approved and as task groups complete.
