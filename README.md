---
schema_version: '1.0'
updated:
  - date: '2026-11-24T04:28:29.964Z'
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
      README configuration section; README sections: writing tools, the server
      class; README sections: launcher, logging, things worth knowing
change_request: mcp-framework
created:
  date: '2026-11-24T04:02:27.000Z'
  user: Keith W. Boone
---
# mcp-framework

A framework for local MCP servers: a detached HTTP daemon, a stdio bridge, a command-line client,
configuration and logging.

## What it is

## Five-minute example

## The launcher definition and the `ctx` object

The launcher file calls `runLauncher(definition)` once. It handles the command line, starts and stops the server and
runs the stdio bridge; it never loads your tool code.

```js
runLauncher({ defaultPort: 7561 });
```

| Field | Meaning |
|---|---|
| `defaultPort` | Required. The port the MCP listens on unless the user's `config.json` sets another. |
| `serverScript` | The server file, relative to the launcher. Default `server.js`. The launcher checks it exists. |
| `nodeArgs` | Node options placed before the server script, for example `['--max-old-space-size=8192']`. |
| `startupTimeoutMs` | How long a start waits for the server to become healthy. Default 30000. The setting of the same name in `config.json` wins. |
| `defaults` | Extra default settings, merged with `port` and written to `config.json` on first run. |
| `validate` | A function that validates or normalizes a configuration before it is saved. Return a replacement, or throw to reject. |
| `options` | Extra launcher options: `[{ name: '--rebuild', description: 'Rebuild the index', handler }]`. They appear in `--help`. A name the framework reserves fails at start-up. |

The MCP's name and version are read from its own `package.json`. The name must be usable as a directory name and
the version must be semver; the launcher fails with a message naming the field otherwise. The launcher also
checks the Node version first: Node 22 or later is required.

### Running, stopping, restarting

| Command | What it does |
|---|---|
| `node index.js` | Start the server as a detached background process and wait until it answers its health check. If the same version is already running it says so and exits 0. An older version is stopped and replaced. A newer version is left alone and the exit is non-zero; stop it with `--stop`, then start normally. |
| `node index.js --stop` | Stop the running server (graceful first), or say it is not running and exit 0. |
| `node index.js --restart` | Stop the running server, if any, and start this version. A newer running version is refused. |
| `node index.js --debug` | Start the server with its log lines also written to the terminal. |
| `node index.js --log-level debug` | Start the server at that log level. A server that is already running keeps its level and the launcher says a restart is needed. |

A stop asks the server to shut down with `POST /shutdown` (answered within 5 seconds, then up to 30 seconds for the
process to exit), falls back to terminating it, force-kills it if it is still alive after 15 seconds, waits up to
5 seconds for the port to free, and removes the process id file. It reports whether the stop was graceful or the
server was killed.

If the server accepts connections but does not answer a health check (5 second timeout), it is running and may be
busy: the launcher says so, names its process id, leaves it alone and exits non-zero. If the connection is refused,
nothing is running: a stale process id file is removed and a server is started.

## Writing tools

Tools are declared once, in a shared file (`tools.js` by convention), with a name, a description and a Zod input
schema, and no handlers. The launcher reads this file to type command-line arguments without a running server, and
the server reads it to register the tools.

```js
const { z } = require('zod');
const { defineTools } = require('@audaciousinquiry/mcp-framework');

module.exports = defineTools([
  {
    name: 'echo',
    description: 'Return the text it is given.',
    inputSchema: z.object({ text: z.string().describe('Text to echo') }),
  },
]);
```

`defineTools` checks every declaration and names the tool and the problem when one is wrong. In the server class,
`this.register(server, tools, handlers)` attaches a handler to each declared tool by name. A handler that is
missing, or a handler for a tool that is not declared, is an error. Every handler is wrapped: an exception becomes
an error result with the stack trace logged, and each call's start, duration and outcome are logged at `info`.

A handler may return a string, an object with a `content` array, or any other value (sent as JSON text). The
helpers `textResult(text)`, `jsonResult(value)` and `errorResult(message)` build results of the standard shape;
`errorResult` sets the error flag. A schema violation is rejected before the handler runs.

Mark a string field as a file path for the command line with `.meta({ 'x-cli': 'file' })`.

## The server class

The server file exports a class that extends `McpServerBase` and starts it only when the file is run directly:

```js
class MyServer extends McpServerBase {
  registerTools(server, context) { this.register(server, tools, handlers); }
}
module.exports = MyServer;
if (require.main === module) new MyServer().run();
```

Only `registerTools` is required. The order is `startup`, bind the port, write the process id file,
`afterListening`. On shutdown the in-flight requests drain, then `shutdown` runs, then the process exits.

| Method | When it runs | Use it for |
|---|---|---|
| `startup(config, log)` | Before the port is bound | Create long-lived resources and return them as the context. A throw is logged with its stack and the server exits non-zero without binding. |
| `registerTools(server, context)` | On every request (required) | Register tools. It must be cheap: register, never create resources. A throw gives a 500 for that request; the server keeps running. |
| `afterListening(context)` | Once the server is listening | Timers, workers and slow setup such as loading a model. Health answers while it runs. A throw shuts the server down non-zero. |
| `healthExtension(context)` | On every `/health` | Extra fields. Base fields cannot be overwritten; a throw still gives 200 with an `extension_error` field. |
| `shutdown(context)` | After in-flight requests drain | Release resources. |

`this.config` and `this.log` are available in every method. The server is stateless: there are no sessions, and
a client can continue after a restart without a new handshake. State that must outlive a request belongs in the
context or in your own storage.

**Routes.** `POST /` carries MCP, `GET /health` returns `status`, `version`, `pid` and `uptime_seconds`, and
`POST /shutdown` starts a graceful stop. Any other route is 404, and `GET` or `DELETE` on `/` is 405.

**Who may call.** The server binds to 127.0.0.1 only. It refuses with 403 any request carrying an `Origin`
header and any request whose `Host` is not `127.0.0.1`, `localhost` or `[::1]` on its own port, so a web page
cannot reach it. It sends no CORS headers.

**Request size.** A body over `maxBodyBytes` (1 MB by default) gets 413 and the message names the setting.

**Shutdown.** `POST /shutdown` (the only graceful stop on Windows), SIGTERM and SIGINT stop accepting
connections, let in-flight requests finish for `drainMs` (10 seconds by default), destroy the rest, run `shutdown`,
remove the process id file and exit 0. A second trigger is ignored.

**Port in use.** If the port is taken, the server reads the occupant's `/health`. An answer with the base fields
means this MCP is already running, and the new process exits 0. Anything else is reported and the process exits
non-zero.

## The command line

## Registering with a client

## Configuration

Each MCP has its own data directory, `~/.mcp/<name>/`, where `<name>` is the `name` in the MCP's
`package.json`. It holds `config.json`, the process id file `server.pid` and the `logs` folder.

The MCP declares its default settings, and `port` is required. Stored values in `config.json` are merged over the
defaults: nested objects merge key by key, arrays are replaced, and keys the defaults do not mention are kept.

Framework settings:

| Setting | Meaning | Default |
|---|---|---|
| `port` | Port on 127.0.0.1, a whole number from 1 to 65535 | declared by the MCP |
| `log_level` | `trace`, `debug`, `info`, `warn` or `error` | `info` |
| `maxBodyBytes` | Largest request body the server accepts | 1048576 (1 MB) |
| `startupTimeoutMs` | How long a start waits for the server to become healthy | 30000 |
| `drainMs` | How long a shutdown lets in-flight requests finish | 10000 |

**First run.** The launcher, the bridge and the command-line commands write the defaults to `config.json` when
the file is missing. The server never creates it; with no file it uses the defaults in memory. A file that is not
valid JSON, or a port outside 1 to 65535, stops the command with a message naming the file; the file is never
overwritten.

**Changed defaults.** Stored values win over defaults. A user whose file holds a value that a later version
of your MCP changes as a default keeps the old value.

**Saving.** The configuration object has a `save` function. `config.save()` stores the current settings,
including changes made in place. `config.save({ setting: value })` merges the update into a copy, runs your
`validate` function (return a normalized copy, or throw to reject), writes the file by temporary file and rename,
and only then updates the object in memory. A rejected update changes nothing.

## Logging

The server writes `server.log` in the `logs` folder of the data directory, one line per message with a
timestamp, level, category and message. The log rolls over each day and when a file reaches 10 MB, and keeps the
7 most recent files. If the folder cannot be written, lines go to standard error and the server keeps running.

**Level.** One of `trace`, `debug`, `info`, `warn`, `error`; the default is `info`. The first of these that is set
wins: the launcher option `--log-level <level>`, the environment variable named after the MCP (the name in upper
case with non-alphanumeric characters replaced by `_`, then `_LOG_LEVEL`, for example `MY_MCP_LOG_LEVEL`), the
`log_level` setting, then `info`. An invalid value fails with a message naming where it came from. The level
applies in worker threads your MCP starts as well.

**Debug mirror.** `--debug` also writes every log line to standard error. It does not change the level; combine
it with `--log-level debug` for debug lines. If standard error stops being writable, for example because the
terminal was closed, the server ignores that and keeps running and keeping its log file.

**Your own logs.** `getLogger('indexer')` returns a named logger that writes to the same file with the same format,
level and rotation. Every tool call logs its start and its duration and outcome at `info`.

**Fatal errors.** An uncaught exception or unhandled promise rejection writes its stack trace, to the log when
there is one and to standard error, and the process exits non-zero.

## Things worth knowing

- **A launcher whose standard error is read through a pipe waits until the server stops.** The server inherits the
  launcher's standard error and holds it open. At a console there is nothing to wait for. A script or tool that
  captures the launcher's output through a pipe should send standard error to a file instead.
- **A default changed in a later version does not reach an existing `config.json`.** Stored values win over defaults.
- **`POST /shutdown` is the only graceful stop on Windows.** A signal sent to another process with `process.kill`
  ends it without running its handlers there. SIGTERM and SIGINT work on Linux and macOS, and Ctrl+C in a terminal.
- **Requests larger than 1 MB are refused with 413.** Raise the `maxBodyBytes` setting if your tools take larger
  inline arguments.

### Troubleshooting

- **Port in use.** If the occupant answers `/health` like a framework server, the new server exits quietly because
  one is already running. Otherwise the launcher names the program's answer; change the port with
  `node index.js init --port <number>`.
- **A server that will not start.** The launcher reports the exit code. Standard error shows failures from before
  the logger started; the rest is in `~/.mcp/<name>/logs/server.log`. `--debug` shows the log on the terminal.
- **A stale process id file.** `server.pid` naming a process that is not running is removed by the next start or
  `--stop`.
