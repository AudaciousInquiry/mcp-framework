---
schema_version: '1.0'
updated:
  - date: '2026-11-24T04:18:05.204Z'
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
      class
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

## Things worth knowing
