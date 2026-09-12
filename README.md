# node-red-temporal

Date and time manipulation nodes for Node-RED. Parse, convert, adjust, and compute durations between date/time values - built on the [TC39 Temporal API](https://tc39.es/proposal-temporal/) via [`temporal-polyfill`](https://www.npmjs.com/package/temporal-polyfill).

**Requirements:** Node.js ≥ 18, Node-RED ≥ 4.0.0

---

## Features

- Read date/time values from `msg`, `flow`, `global` context, or the current timestamp
- Parse all common formats - ISO 8601, Unix timestamps, RFC 2822, JavaScript Date objects, and custom Moment.js-style format strings
- Timezone-aware conversion using IANA timezone names (`Europe/Amsterdam`) or UTC offsets (`+02:00`)
- Optional time adjustment with a compact expression syntax (`+1y -2M +3d`)
- Compute durations between two timestamps in multiple output formats
- Interval measurement mode - automatically tracks the gap between consecutive messages

---

## Installation

```bash
npm install @theotherwillembotha/node-red-temporal
```

Or search for `node-red-temporal` in the Node-RED palette manager.

---

## Table of Contents

1. [Temporal Transform](#temporal-transform)
2. [Temporal Duration](#temporal-duration)
3. [Format reference](#format-reference)
4. [Custom format strings](#custom-format-strings)
5. [Adjustment string syntax](#adjustment-string-syntax)
6. [Timezone reference](#timezone-reference)
7. [Error handling](#error-handling)
8. [Examples](#examples)

---

## Temporal Transform

Transforms a date/time value from one representation to another in a single node.

![Temporal Transform editor](https://raw.githubusercontent.com/theotherwillembotha/nodered_temporal/main/documentation/TemporalTransformNode.png)

### Input

| Field | Description |
|-------|-------------|
| **From** | Where to read the date/time value. Supports `msg`, `flow`, and `global` properties, or **timestamp (now)** to capture the current time when the message arrives. |
| **Format** | How the input value is encoded. Choose a named preset or enter a custom format string. Can also be read dynamically from a `msg`, `flow`, or `global` property. |
| **Timezone** | The timezone the input value is expressed in. Required for formats that carry no timezone information (`date`, `datetime`, `unix-s`, `unix-ms`, `rfc2822`, and custom formats). Accepts IANA names or UTC offset strings. Can also be read from a property. |

> When **From** is set to **timestamp (now)**, Format is locked to *milliseconds since epoch* and Timezone has no effect.

### Modification

| Field | Description |
|-------|-------------|
| **Adjust by** | An optional expression that shifts the time value before output. Leave empty to pass through unchanged. A live preview below the field describes the adjustment in plain English - invalid expressions are highlighted in red. See [Adjustment string syntax](#adjustment-string-syntax). |

### Output

| Field | Description |
|-------|-------------|
| **To** | Where to write the result. Supports `msg`, `flow`, and `global` properties. |
| **Format** | How to encode the output value. Choose a named preset or enter a custom format string. Can also be read dynamically from a property. |
| **Timezone** | The timezone to express the output value in. Accepts IANA names or UTC offset strings. |

---

## Temporal Duration

Computes the duration between two date/time values.

![Temporal Duration editor](https://raw.githubusercontent.com/theotherwillembotha/nodered_temporal/main/documentation/TemporalDurationNode.png)

### From Time / To Time

Each endpoint has the same three fields:

| Field | Description |
|-------|-------------|
| **From / To** | Where to read the date/time value. Supports `msg`, `flow`, and `global` properties, **timestamp (now)** to use the current time, or **previous message** (From only - see below). |
| **Format** | How the value is encoded. Choose a named preset or a custom format string. Hidden when **timestamp (now)** or **previous message** is selected. |
| **Timezone** | The IANA timezone or UTC offset the value is expressed in. Required for formats that carry no timezone information. |

The duration is always computed as **To − From** (positive when To is later than From).

#### Interval measurement - "previous message" mode

When **From** is set to **previous message**:

- The **first message** stores the To time as a baseline and is **not forwarded**.
- Every **subsequent message** computes the duration from the stored baseline to the current To time, writes the output, then stores the current To time as the new baseline.
- The stored baseline **resets when the flow is redeployed**.

This mode is useful for measuring the interval between recurring messages - sensor readings, heartbeats, pipeline throughput.

### Offset

| Field | Description |
|-------|-------------|
| **Offset by** | An optional expression that shifts the computed duration before output. Uses the same syntax as the Temporal Transform **Adjust by** field. Leave empty for no adjustment. |

### Output

| Field | Description |
|-------|-------------|
| **To** | Where to write the result. Supports `msg`, `flow`, and `global` properties. |
| **Mode** | How to express the duration. See output modes below. |

#### Output modes

| Mode | Output type | Description |
|------|-------------|-------------|
| **Total in unit** | `number` | The entire duration as a single numeric value in the selected unit (milliseconds, seconds, minutes, hours, or days). Fractional values are returned where applicable. |
| **Duration components** | `object` | A plain object with keys `years`, `months`, `weeks`, `days`, `hours`, `minutes`, `seconds`, `milliseconds`. Values are broken down from the selected **Largest unit** downward - fields for larger units are always zero. |
| **ISO 8601 string** | `string` | The duration as an ISO 8601 duration string, e.g. `P1Y2M3DT4H5M6S`. |
| **Human readable** | `string` | A locale-formatted string using `Intl.DurationFormat` with English locale and the selected style. |

**Human readable styles**

| Style | Example |
|-------|---------|
| Long | `2 hours, 30 minutes, 5 seconds` |
| Short | `2 hr., 30 min., 5 sec.` |
| Narrow | `2h 30m 5s` |

---

## Format reference

The following named presets are available in both nodes:

| Preset | Description | Example |
|--------|-------------|---------|
| `iso` | ISO 8601 with timezone offset | `2024-05-16T14:30:00+02:00` |
| `iso-utc` | ISO 8601 UTC (Zulu) | `2024-05-16T12:30:00.000Z` |
| `date` | Date only | `2024-05-16` |
| `datetime` | Date and local time (no timezone) | `2024-05-16 14:30:00` |
| `unix-s` | Seconds since epoch | `1715860200` |
| `unix-ms` | Milliseconds since epoch | `1715860200000` |
| `js-date` | JavaScript Date object | *(Node.js `Date` instance)* |
| `rfc2822` | RFC 2822 email date format | `Thu, 16 May 2024 14:30:00 +0200` |

---

## Custom format strings

Select **custom** to enter a format string using Moment.js-style tokens. Tokens are case-sensitive and matched longest-first.

| Token | Description | Example | Token | Description | Example |
|-------|-------------|---------|-------|-------------|---------|
| `YYYY` | Year (4-digit) | `2024` | `hh` | Hour 12 h, padded | `02` |
| `YY` | Year (2-digit) | `24` | `h` | Hour 12 h | `2` |
| `MM` | Month, padded | `05` | `mm` | Minute, padded | `30` |
| `M` | Month | `5` | `m` | Minute | `30` |
| `DD` | Day, padded | `06` | `ss` | Second, padded | `05` |
| `D` | Day | `6` | `s` | Second | `5` |
| `HH` | Hour 24 h, padded | `14` | `SSS` | Milliseconds | `047` |
| `H` | Hour 24 h | `14` | `A` / `a` | AM/PM or am/pm | `PM` |

Any character that does not match a token is treated as a literal separator (e.g. `-`, `/`, ` `, `:`).

**Examples**

| Format string | Output |
|---------------|--------|
| `YYYY-MM-DD` | `2024-05-16` |
| `DD/MM/YYYY` | `16/05/2024` |
| `DD/MM/YYYY HH:mm:ss` | `16/05/2024 14:30:05` |
| `YYYY-MM-DD HH:mm:ss.SSS` | `2024-05-16 14:30:05.047` |
| `hh:mm:ss A` | `02:30:05 PM` |
| `YYYY-MM-DDTHH:mm:ss` | `2024-05-16T14:30:05` |

> Named month abbreviations (e.g. `Jan`, `Feb`) are not supported - the format system works with numeric values only.

---

## Adjustment string syntax

The **Adjust by** field (Temporal Transform) and **Offset by** field (Temporal Duration) accept the same compact expression syntax.

### Units

| Token | Unit | Token | Unit |
|-------|------|-------|------|
| `y` | Years (calendar) | `H` | Hours |
| `M` | Months (calendar) | `m` | Minutes |
| `w` | Weeks (= 7 days) | `s` | Seconds |
| `d` | Days | `S` | Milliseconds |

> Tokens are **case-sensitive**: `M` is months, `m` is minutes; `H` is hours, `S` is milliseconds.

### Syntax rules

- Prefix each group with `+` (add) or `-` (subtract).
- A sign applies to all units that follow it until the next sign: `-1H30m` subtracts both 1 hour **and** 30 minutes.
- Multiple groups can be combined freely: `+1y -2M +3d`
- Whitespace is ignored: `+1y -2M` and `+1y-2M` are equivalent.
- The same unit may appear multiple times - values are accumulated: `+1H +1H` equals `+2H`.
- An empty string means no adjustment - the value passes through unchanged.

### Examples

| String | Effect |
|--------|--------|
| `+1y` | Add 1 year |
| `-30m` | Subtract 30 minutes |
| `+1y4d` | Add 1 year and 4 days |
| `+1y4d-40m+20m` | Add 1 year, add 4 days, subtract net 20 minutes |
| `+1M -1d` | Add 1 month, subtract 1 day |
| `-1H30m` | Subtract 1 hour and 30 minutes |
| `+500S` | Add 500 milliseconds |
| `+1w3d` | Add 10 days (1 week + 3 days) |

### Calendar unit behaviour

Calendar units (`y` and `M`) operate on the calendar date, not a fixed duration. The result is clamped to the last valid day of the month where necessary:

- Adding 1 month to `2024-01-31` → `2024-02-29` (leap year end of February)
- Adding 1 year to `2024-02-29` → `2025-02-28` (non-leap year)

---

## Timezone reference

Timezone fields accept:

- **IANA timezone names** - e.g. `Europe/Amsterdam`, `America/New_York`, `Asia/Tokyo`, `UTC`
- **UTC offset strings** - e.g. `+02:00`, `-05:30`, `+00:00`

An autocomplete dropdown is available in the editor for IANA names. The full list is sourced from the server's `Intl.supportedValuesOf('timeZone')`.

---

## Error handling

If a date/time value cannot be parsed, or if an adjustment/offset expression is invalid:

- The message is **dropped** (not forwarded to the output).
- A **warning** is logged on the node, visible in the Node-RED debug panel.

Downstream nodes only receive messages that were processed successfully.

---

## Examples

### Convert a Unix timestamp to a human-readable local time

| Field | Value |
|-------|-------|
| From | `msg.payload` - milliseconds since epoch |
| Timezone | `UTC` |
| To | `msg.payload` |
| Output Format | `YYYY-MM-DD HH:mm:ss` (custom) |
| Output Timezone | `Europe/Amsterdam` |

`1715860200000` → `2024-05-16 14:30:00`

---

### Add a 5-day offset and output ISO UTC

| Field | Value |
|-------|-------|
| From | `msg.payload` - ISO 8601 with offset |
| Adjust by | `+5d` |
| Output Format | `iso-utc` |

`2024-05-16T14:30:00+02:00` → `2024-05-21T12:30:00.000Z`

---

### Capture the current time in a local timezone

| Field | Value |
|-------|-------|
| From | timestamp (now) |
| To | `msg.timestamp` |
| Output Format | `YYYY-MM-DD HH:mm:ss` (custom) |
| Output Timezone | `Africa/Johannesburg` |

Writes the current local time in Johannesburg to `msg.timestamp`.

---

### Compute the total seconds between two timestamps

| Field | Value |
|-------|-------|
| From | `msg.start` - milliseconds since epoch, timezone UTC |
| To | `msg.end` - milliseconds since epoch, timezone UTC |
| Mode | Total in unit - Seconds |
| Output To | `msg.payload` |

---

### Measure the interval between messages

| Field | Value |
|-------|-------|
| From | previous message |
| To | `msg.payload` - milliseconds since epoch, timezone UTC |
| Mode | Total in unit - Milliseconds |
| Output To | `msg.interval` |

The first message is stored as the baseline and dropped. Every subsequent message writes the elapsed milliseconds since the previous one to `msg.interval`.

---

## License

ISC
