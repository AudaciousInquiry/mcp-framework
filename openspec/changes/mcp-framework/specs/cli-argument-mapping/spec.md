---
schema_version: '1.0'
created:
  date: '2026-11-18T13:14:20.825Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: cli-argument-mapping spec for mcp-framework
updated:
  - date: '2026-11-18T14:33:55.254Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~e148b5d8-e4eb-4d94-abe8-9e4b485b264f
    summary: Extend argument mapping to init
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Command-line arguments as an alternative to JSON

`call <tool>` SHALL accept the tool's arguments as ordinary command-line arguments of the form `--name value`
or `--name=value`, in addition to a JSON object. The two MAY be combined in one call. The JSON, whether inline
or from an `@file`, SHALL be applied first, and the command-line arguments SHALL then be set on top of it, so a
command-line argument overrides the same field in the JSON.

#### Scenario: Flags only
- **WHEN** `call tool --title Hello --count 3` is run for a tool whose schema has a string `title` and an integer `count`
- **THEN** the tool receives `{ "title": "Hello", "count": 3 }`

#### Scenario: Both forms of a value
- **WHEN** `--title Hello` and `--title=Hello` are used
- **THEN** both produce the same argument

#### Scenario: JSON first, flags on top
- **WHEN** `call tool '{"title":"A","count":1}' --title B` is run
- **THEN** the tool receives `{ "title": "B", "count": 1 }`

#### Scenario: JSON from a file combined with flags
- **WHEN** `call tool @base.json --count 5` is run
- **THEN** the object in the file is applied first and `count` is then set to 5

#### Scenario: JSON alone is unchanged
- **WHEN** only a JSON object is given
- **THEN** the tool receives that object exactly as before this capability existed

### Requirement: The tool's own schema decides the types

The CLI SHALL read the tool's input schema from the running server and use it to convert each argument to the
type the tool declares. It SHALL NOT guess types from the look of the value. A value that is a valid number
SHALL stay a string when the schema says the field is a string.

#### Scenario: Numeric-looking string
- **WHEN** `--code 007` is given and the schema says `code` is a string
- **THEN** the tool receives the string `"007"`

#### Scenario: String-looking number
- **WHEN** `--count 7` is given and the schema says `count` is an integer
- **THEN** the tool receives the number 7

#### Scenario: No schema information
- **WHEN** a property has no usable type in the schema
- **THEN** its value is sent as a string

### Requirement: Scalar conversion

The CLI SHALL convert values according to the declared type. Numbers SHALL be plain decimal numbers, with an
optional sign, fraction, and exponent; integers SHALL have no fraction. Booleans SHALL be written as `--flag`
(true), `--no-flag` (false), `--flag=true`, or `--flag=false`. A value for an enumeration SHALL be one of the
allowed values.

#### Scenario: Number
- **WHEN** `--ratio 0.25` is given for a number field
- **THEN** the tool receives 0.25

#### Scenario: Negative number
- **WHEN** `--offset -5` is given for a number field
- **THEN** the value `-5` is taken as the field's value and not as another option

#### Scenario: Not a number
- **WHEN** `--count abc` or `--count 1,000` or `--count 0x10` is given for a numeric field
- **THEN** the command fails naming the field and the value, and the tool is not called

#### Scenario: Fraction for an integer field
- **WHEN** `--count 2.5` is given for an integer field
- **THEN** the command fails naming the field

#### Scenario: Boolean forms
- **WHEN** `--verbose`, `--no-verbose`, `--verbose=false` are given for a boolean field
- **THEN** the tool receives true, false, and false respectively

#### Scenario: Enumeration
- **WHEN** a value outside the allowed values is given for an enumeration field
- **THEN** the command fails and lists the allowed values

### Requirement: Quoting in string values

A string value MAY be wrapped in single or double quotes. The quotes SHALL be removed from the value. A quote
character inside a quoted string SHALL be written as `\"` or `\'` and SHALL become the plain character. A quote
opens a quoted string only at the start of a value or of an array element; elsewhere a quote character is a
literal character. A backslash that is not directly followed by a quote character SHALL be a literal backslash,
so Windows paths pass through unchanged. A quote that is never closed SHALL be an error.

#### Scenario: Quotes removed
- **WHEN** the value reaches the CLI as `"hello world"`
- **THEN** the tool receives `hello world`

#### Scenario: Escaped quote
- **WHEN** the value reaches the CLI as `"say \"hi\""`
- **THEN** the tool receives `say "hi"`

#### Scenario: Apostrophe in unquoted text
- **WHEN** the value is `don't stop`
- **THEN** the tool receives `don't stop` unchanged

#### Scenario: Windows path
- **WHEN** the value is `C:\Users\me\notes.md`
- **THEN** the backslashes are preserved

#### Scenario: Unterminated quote
- **WHEN** the value is `"abc`
- **THEN** the command fails naming the argument and the unterminated quote

#### Scenario: Shell quoting comes first
- **WHEN** the user's shell removes its own quotes before the CLI runs
- **THEN** the CLI works with whatever text remains, and the documentation shows the forms that work in cmd.exe and in POSIX shells

### Requirement: Arrays are comma-separated

A value for an array field SHALL be a comma-separated list. A comma inside a quoted element SHALL NOT separate
elements. Each element SHALL be converted according to the array's item type and the quoting rules above.

#### Scenario: Simple list
- **WHEN** `--tags a,b,c` is given for an array of strings
- **THEN** the tool receives `["a","b","c"]`

#### Scenario: Comma inside quotes
- **WHEN** the value reaches the CLI as `"a,b",c`
- **THEN** the tool receives `["a,b","c"]`

#### Scenario: Typed elements
- **WHEN** `--ids 1,2,3` is given for an array of integers
- **THEN** the tool receives `[1,2,3]`

#### Scenario: Empty value
- **WHEN** `--tags ""` is given for an array field
- **THEN** the tool receives an empty array

#### Scenario: Bad element
- **WHEN** one element cannot be converted to the item type
- **THEN** the command fails naming the field and the element position

### Requirement: Fields declared as string or list

When a schema allows a field to be either a string or an array of strings, a value with an unquoted comma
SHALL be sent as an array and a value without one SHALL be sent as a string. A value that is entirely quoted
SHALL be sent as a string.

#### Scenario: Single value
- **WHEN** `--tags solo` is given
- **THEN** the tool receives the string `"solo"`

#### Scenario: Several values
- **WHEN** `--tags a,b` is given
- **THEN** the tool receives `["a","b"]`

#### Scenario: Quoted single string with a comma
- **WHEN** the value reaches the CLI as `"a,b"`
- **THEN** the tool receives the string `"a,b"`

### Requirement: Dotted names set nested fields

A dotted argument name `--a.b.c value` SHALL set field `c` of object `b` of object `a`, creating the
intermediate objects when they do not exist. Setting a nested field SHALL merge into an object already
present from the JSON or from an earlier argument, without discarding that object's other fields. A numeric
segment SHALL address an element of an array field.

#### Scenario: Nested field
- **WHEN** `--provenance.agent.name claude` is given
- **THEN** the tool receives `{ "provenance": { "agent": { "name": "claude" } } }`

#### Scenario: Merge into JSON
- **WHEN** the JSON has `{"provenance":{"session_id":"s1","summary":"x"}}` and `--provenance.summary y` is given
- **THEN** the tool receives `session_id` `s1` and `summary` `y` in `provenance`

#### Scenario: Several nested arguments
- **WHEN** `--p.a 1 --p.b 2` are given
- **THEN** both fields are set in the same object `p`

#### Scenario: Nested type from the schema
- **WHEN** `--p.count 4` is given and the nested schema says `count` is an integer
- **THEN** the tool receives the number 4

#### Scenario: Array element
- **WHEN** `--items.1.name second` is given for an array of objects
- **THEN** the second element's `name` is set

#### Scenario: Whole object as JSON
- **WHEN** `--provenance '{"agent":{"name":"claude"}}'` is given for an object field
- **THEN** the value is parsed as JSON and set as that field

#### Scenario: Whole object plus dotted override
- **WHEN** a whole-object JSON argument and a dotted argument for the same object are both given
- **THEN** the object is set first and the dotted argument is then set on it

### Requirement: Dates and date-times

A date field SHALL be sent as `YYYY-MM-DD`. A date-time field SHALL be sent as a UTC timestamp ending in `Z`.
The CLI SHALL accept ISO 8601 dates and date-times, with or without a time zone, and the relative forms below.
A date-time given without a zone, and a date given for a date-time field, SHALL be read in the user's local
time zone and then converted to UTC. Natural-language dates other than the relative forms SHALL NOT be accepted.

The relative forms are: `now`, `today`, `yesterday`, `tomorrow`, and an offset from now written as a sign,
a whole number, and a unit: `d` days, `w` weeks, `h` hours, `m` minutes (for example `-7d`, `+2w`, `-3h`,
`+30m`). For a date field a relative form means the local calendar date it falls on; for a date-time field,
`today`, `yesterday`, and `tomorrow` mean local midnight of that day, and `now` and offsets mean that instant.

#### Scenario: ISO date for a date field
- **WHEN** `--since 2026-11-18` is given for a date field
- **THEN** the tool receives `"2026-11-18"`

#### Scenario: Date for a date-time field
- **WHEN** `--since 2026-11-18` is given for a date-time field and the local zone is UTC-5
- **THEN** the tool receives `"2026-11-18T05:00:00.000Z"`

#### Scenario: Time zone offset in the input
- **WHEN** `--at 2026-11-18T09:30:00-05:00` is given for a date-time field
- **THEN** the tool receives `"2026-11-18T14:30:00.000Z"`

#### Scenario: Relative offset starting with a dash
- **WHEN** `--since -7d` is given
- **THEN** the value is taken as the field's value and not as an option, and resolves to seven days before now

#### Scenario: Relative word for a date field
- **WHEN** `--until yesterday` is given for a date field
- **THEN** the tool receives yesterday's local calendar date

#### Scenario: Unrecognized text
- **WHEN** `--since "last tuesday"` is given
- **THEN** the command fails naming the field and lists the accepted forms

#### Scenario: Impossible date
- **WHEN** `--since 2026-02-30` is given
- **THEN** the command fails naming the field and the value

### Requirement: File path arguments

A field the tool author marked as a file path SHALL be sent as an absolute path. A relative path SHALL be
resolved against the directory the command was run from, because the server runs in a different directory.
The CLI SHALL NOT require the file to exist, because tools may create files. The author marks a field by
adding the metadata key `x-cli` with the value `file` to the field's schema.

#### Scenario: Relative path
- **WHEN** `--path notes\a.md` is given for a field marked as a file path and the command is run from `C:\work`
- **THEN** the tool receives `C:\work\notes\a.md`

#### Scenario: Absolute path
- **WHEN** an absolute path is given
- **THEN** it is sent unchanged apart from normalization

#### Scenario: File that does not exist yet
- **WHEN** the path names a file that does not exist
- **THEN** the path is still sent

#### Scenario: Field not marked
- **WHEN** a path is given for an ordinary string field
- **THEN** it is sent as the string typed, without resolving it

### Requirement: File contents with the @ prefix

A value whose first unquoted character is `@` SHALL be read as the path of a file whose contents become the
value. For a string field the contents SHALL be the string, read as UTF-8. For an object or array field the
contents SHALL be parsed as JSON. A value in which the `@` is inside quotes SHALL be a literal string. A missing
or unreadable file SHALL be an error.

#### Scenario: Contents into a string field
- **WHEN** `--content @notes.md` is given for a string field
- **THEN** the tool receives the text of `notes.md`

#### Scenario: JSON into an object field
- **WHEN** `--provenance @prov.json` is given for an object field and the file holds a JSON object
- **THEN** the tool receives that object

#### Scenario: Literal at sign
- **WHEN** the value reaches the CLI as `'@alice'`
- **THEN** the tool receives the string `@alice`

#### Scenario: Missing file
- **WHEN** the file does not exist
- **THEN** the command fails naming the file and the field, and the tool is not called

#### Scenario: Invalid JSON in the file
- **WHEN** an object field's file does not contain valid JSON
- **THEN** the command fails naming the file and the parse error

### Requirement: Fail fast on unknown or conflicting arguments

The CLI SHALL stop before calling the tool, with a one-line message naming the argument, when an argument is
not in the tool's schema, appears more than once, has the wrong type, or conflicts with another argument. The
message SHALL list the valid names when an unknown name is close to a real one.

#### Scenario: Unknown name
- **WHEN** `--titel Hello` is given and the schema has `title`
- **THEN** the command fails saying `titel` is not an argument of the tool and suggests `title`

#### Scenario: Repeated argument
- **WHEN** `--title A --title B` is given
- **THEN** the command fails saying `title` was given twice

#### Scenario: Scalar then child
- **WHEN** the JSON sets `provenance` to a string and `--provenance.agent x` is given
- **THEN** the command fails saying `provenance` is not an object

#### Scenario: Schema allows extra properties
- **WHEN** the schema declares that additional properties are allowed
- **THEN** an unknown name is accepted and its value is sent as a string

#### Scenario: Nothing reaches the server
- **WHEN** any of these checks fails
- **THEN** the tool is not called and the exit status is non-zero

### Requirement: Argument help for a tool

`call <tool> --help` SHALL print the tool's arguments as they are written on the command line: each name
(with dotted names for nested fields), its type, whether it is required, its description, and notes for dates,
file paths, and lists.

#### Scenario: Help for a tool
- **WHEN** `call tool --help` is run
- **THEN** every argument is listed, with nested fields shown by dotted name and file-path and date arguments noted

#### Scenario: Help does not call the tool
- **WHEN** `--help` is given
- **THEN** the tool is not called

### Requirement: The same conversion for init

The `init` command SHALL convert its arguments with exactly the same rules as `call`: the same syntax,
quoting, arrays, dotted names, dates, file paths, the `@` prefix, merge order, and failure behavior. The only
difference SHALL be where the types come from: for `call`, the tool's input schema from the running server; for
`init`, the MCP's settings schema, with a setting that has no declared type typed from its default value.

#### Scenario: One implementation
- **WHEN** the same text is given as a value to `call` for a field and to `init` for a setting of the same declared type
- **THEN** both produce the same converted value

#### Scenario: Help for init
- **WHEN** `init --help` is run
- **THEN** every setting is listed as it is written on the command line, with its type, its default, and its description, and nothing is saved

#### Scenario: Setting that cannot be typed
- **WHEN** a setting has no declared type and its default is null
- **THEN** its value is sent as a string and `init --help` says the setting is untyped
