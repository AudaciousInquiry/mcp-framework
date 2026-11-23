---
schema_version: '1.0'
created:
  date: '2026-11-18T13:14:57.616Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: mcp-configuration spec for mcp-framework
updated:
  - date: '2026-11-23T19:00:55.954Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~0f71d015-1678-4f48-8b79-a1b94ba8045d
    summary: >-
      Save function: no argument stores current config; with an update it is
      apply-or-nothing; init uses it
  - date: '2026-11-23T16:20:10.935Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~71239349-b897-4f83-9ab3-268e9d4b07ec
    summary: >-
      Only the launcher side writes config.json on first run; the server only
      reads
  - date: '2026-11-21T17:31:02.597Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~937d316c-37fa-4201-8540-d40b1f6244b3
    summary: A corrupt configuration file stops the start; the user corrects it
  - date: '2026-11-20T22:44:36.816Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~ecf40986-d475-42f5-938d-a472d6e1aecb
    summary: >-
      Split the Init command requirement into three single-behavior
      requirements; no behavior change
  - date: '2026-11-18T14:03:42.545Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~e148b5d8-e4eb-4d94-abe8-9e4b485b264f
    summary: >-
      init takes the same typed command-line arguments as call, typed from a
      settings schema
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Per-MCP configuration file in a data directory

Each MCP SHALL have its own data directory, `.mcp/<mcp-name>/` under the user's home directory, holding its
configuration file `config.json`, its process id file, and its logs. The framework SHALL create the directory
when it is first needed. The directory and file of one MCP SHALL NOT be shared with another.

#### Scenario: First run from the launcher side
- **WHEN** the launcher, the bridge, or a command-line command loads the configuration and no configuration file exists
- **THEN** the data directory is created and a configuration file holding the defaults is written

#### Scenario: The server never creates the file
- **WHEN** the server loads the configuration and no configuration file exists
- **THEN** it uses the defaults in memory, creates only the data directory it needs, and does not write the configuration file

#### Scenario: Two MCPs
- **WHEN** two MCPs built on the framework run on the same machine
- **THEN** each reads and writes only its own directory

### Requirement: The MCP declares its defaults, including its port

The MCP SHALL supply its default settings when it plugs into the framework, and the default port SHALL be a
required part of them. The framework SHALL use the declared port unless the user's configuration file sets
another.

#### Scenario: Declared default
- **WHEN** an MCP declares port 7561 and the configuration file has no port
- **THEN** the server listens on 7561 and the CLI connects to 7561

#### Scenario: User override
- **WHEN** the configuration file sets a port
- **THEN** that port is used by the server, the launcher, the bridge, and the CLI

#### Scenario: Port not declared
- **WHEN** an MCP plugs in without declaring a default port
- **THEN** the framework refuses to start and says that a default port is required

### Requirement: Stored values over defaults

When a configuration is loaded, the stored values SHALL be merged over the defaults, so a setting added to the
MCP's defaults in a later version is present for users whose file predates it. Nested settings declared as
objects SHALL be merged key by key. Keys in the file that the defaults do not mention SHALL be kept.

#### Scenario: New default after upgrade
- **WHEN** a newer version adds a default setting and the user's file lacks it
- **THEN** the loaded configuration has the new setting at its default

#### Scenario: Nested object
- **WHEN** a default object has keys `a` and `b` and the file sets only `a`
- **THEN** the loaded object has the stored `a` and the default `b`

#### Scenario: Unknown key
- **WHEN** the file holds a key the defaults do not declare
- **THEN** the key is present in the loaded configuration and is preserved when the file is saved

### Requirement: Saving updates

The framework SHALL provide a save function that an implementer can call, and the command-line `init` SHALL use
the same function. Called with no argument it stores the current configuration, including changes the
implementer made in place. Called with a partial set of settings it merges them into a copy of the current
configuration, and updates the in-memory configuration only after the copy has been validated and written.
Either form returns the full result. The MCP MAY supply a function that validates or normalizes the
configuration, such as clamping a number to a minimum or rejecting a bad value, and the framework SHALL apply
it before writing. A write SHALL NOT leave a truncated file if the process stops part way through.

#### Scenario: Partial update
- **WHEN** an update sets one setting
- **THEN** every other stored setting is unchanged and the full configuration is returned

#### Scenario: Save the current configuration
- **WHEN** the implementer changes a setting in the loaded configuration and calls save with no argument
- **THEN** the file holds the changed configuration and the full configuration is returned

#### Scenario: Rejected update changes nothing
- **WHEN** save is called with an update that the MCP's function rejects
- **THEN** nothing is written and the in-memory configuration is unchanged

#### Scenario: Zero is a real value
- **WHEN** an update sets a numeric setting to 0
- **THEN** 0 is stored and not replaced by the default

#### Scenario: MCP normalizes
- **WHEN** the MCP's function raises a value below its minimum
- **THEN** the adjusted value is what is written

#### Scenario: MCP rejects
- **WHEN** the MCP's function rejects a value
- **THEN** nothing is written and the caller receives the reason

#### Scenario: Interrupted write
- **WHEN** the process is killed while a save is in progress
- **THEN** the file holds either the complete old content or the complete new content

### Requirement: Invalid configuration is reported, not hidden

A configuration file that is not valid JSON, or whose port is not a whole number from 1 to 65535, SHALL
produce an error that names the file and the problem. The file SHALL NOT be overwritten with defaults in
that case, and no server SHALL be started from it: the user corrects the file and tries again.

#### Scenario: Corrupt file
- **WHEN** the file cannot be parsed
- **THEN** the command fails with a message naming the file and the parse error, and the file is left as it was

#### Scenario: Start with a corrupt file
- **WHEN** a start is requested and the configuration file cannot be parsed
- **THEN** no server is started, the launcher exits non-zero, and the message tells the user to correct the file and run the command again

#### Scenario: Bad port
- **WHEN** the file sets the port to 0, 70000, or text
- **THEN** the command fails naming the setting and the allowed range

### Requirement: Init saves settings given as arguments

The launcher SHALL accept `init [json|@file] [arguments]`. The arguments SHALL be written and converted
exactly as for `call` (see the argument-mapping capability): `--port 7561`, `--no-name`, dotted names for
nested settings, quoting, comma-separated lists, dates, file paths, and the `@` prefix, with any JSON applied
first and the command-line arguments set on top. The types SHALL come from the MCP's settings schema, written
in Zod, which covers the framework's own settings as well; a setting with no declared type SHALL be typed from
the type of its default value. `init` SHALL work without a running server and SHALL NOT start one. When any
settings are given it SHALL save them without prompting.

#### Scenario: Non-interactive with JSON
- **WHEN** `init '{"port":7561}'` is run
- **THEN** the port is saved and the full configuration is printed

#### Scenario: Non-interactive with arguments
- **WHEN** `init --port 7561 --log_level debug` is run
- **THEN** the port is saved as the number 7561 and the log level as the string `debug`

#### Scenario: JSON and arguments together
- **WHEN** `init @base.json --port 7562` is run
- **THEN** the settings in the file are applied first and the port is then set to 7562

#### Scenario: Nested setting
- **WHEN** `init --reindex_defaults.agent.name claude` is run and the setting is a nested object
- **THEN** only that field is set and the object's other fields are kept

#### Scenario: Unknown setting
- **WHEN** `init --prot 7561` is run and no such setting exists
- **THEN** the command fails naming `prot`, suggests `port`, and saves nothing

#### Scenario: Wrong type
- **WHEN** `init --port abc` is run
- **THEN** the command fails naming the setting and the value, and saves nothing

#### Scenario: Setting typed from its default
- **WHEN** a setting has no declared type and its default is a boolean, and `init --no-feature` is run
- **THEN** the setting is saved as false

#### Scenario: No server needed
- **WHEN** `init --port 7561` is run and the server has never been started
- **THEN** the setting is saved and no server is started

### Requirement: Init prompts when given no settings

Without arguments, `init` SHALL prompt for each setting the framework and the MCP declared as promptable,
showing the current value and keeping it when the user presses Enter. A value that fails validation SHALL be
rejected and nothing saved.

#### Scenario: Interactive
- **WHEN** `init` is run in a terminal and the user answers only the port prompt
- **THEN** the port is updated and the other settings keep their values

#### Scenario: Invalid answer
- **WHEN** the user enters a value that fails validation
- **THEN** the command reports why and saves nothing

### Requirement: Init reports the result

When `init` finishes, it SHALL print the resulting configuration and how to start the server and register it
with a client.

#### Scenario: Next steps
- **WHEN** init finishes
- **THEN** it prints how to start the server and examples for registering it with a client over stdio and over HTTP
