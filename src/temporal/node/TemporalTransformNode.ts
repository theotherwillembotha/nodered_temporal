import { Temporal } from 'temporal-polyfill';
import { Node } from "node-red";
import { BaseNode, BaseNodeConfig, NodeDescription, onInput } from "@theotherwillembotha/node-red-plugincore";
import { SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { TemporalService } from "../service/TemporalService";

export interface TemporalTransformNodeConfig extends BaseNodeConfig {
    // Input
    inputFrom: string;
    inputFromType: string;
    inputFormat: string;
    inputFormatType: string;
    inputTimezone: string;
    inputTimezoneType: string;

    // Modification
    adjustmentString: string;

    // Output
    outputFormat: string;
    outputFormatType: string;
    outputTimezone: string;
    outputTimezoneType: string;
    outputTo: string;
    outputToType: string;
}

// Custom format tokens — ordered longest-first to prevent partial matches (e.g. MM before M)
type CustomField = 'year' | 'yearShort' | 'month' | 'day' | 'hour' | 'hour12' | 'minute' | 'second' | 'millisecond' | 'ampm';
const CUSTOM_TOKENS: { token: string; field: CustomField; pattern: string; pad: number }[] = [
    { token: 'YYYY', field: 'year',        pattern: '\\d{4}',    pad: 4 },
    { token: 'YY',   field: 'yearShort',   pattern: '\\d{2}',    pad: 2 },
    { token: 'MM',   field: 'month',       pattern: '\\d{1,2}',  pad: 2 },
    { token: 'DD',   field: 'day',         pattern: '\\d{1,2}',  pad: 2 },
    { token: 'HH',   field: 'hour',        pattern: '\\d{1,2}',  pad: 2 },
    { token: 'hh',   field: 'hour12',      pattern: '\\d{1,2}',  pad: 2 },
    { token: 'mm',   field: 'minute',      pattern: '\\d{1,2}',  pad: 2 },
    { token: 'ss',   field: 'second',      pattern: '\\d{1,2}',  pad: 2 },
    { token: 'SSS',  field: 'millisecond', pattern: '\\d{1,3}',  pad: 3 },
    { token: 'M',    field: 'month',       pattern: '\\d{1,2}',  pad: 0 },
    { token: 'D',    field: 'day',         pattern: '\\d{1,2}',  pad: 0 },
    { token: 'H',    field: 'hour',        pattern: '\\d{1,2}',  pad: 0 },
    { token: 'h',    field: 'hour12',      pattern: '\\d{1,2}',  pad: 0 },
    { token: 'm',    field: 'minute',      pattern: '\\d{1,2}',  pad: 0 },
    { token: 's',    field: 'second',      pattern: '\\d{1,2}',  pad: 0 },
    { token: 'A',    field: 'ampm',        pattern: 'AM|PM',     pad: 0 },
    { token: 'a',    field: 'ampm',        pattern: 'am|pm',     pad: 0 },
];

// Adjustment unit tokens mapped to their Temporal.Duration property names
const ADJUSTMENT_UNITS: { token: string; durationKey: keyof Temporal.DurationLike }[] = [
    { token: 'y', durationKey: 'years'        },
    { token: 'M', durationKey: 'months'       },
    { token: 'w', durationKey: 'weeks'        },
    { token: 'd', durationKey: 'days'         },
    { token: 'H', durationKey: 'hours'        },
    { token: 'm', durationKey: 'minutes'      },
    { token: 's', durationKey: 'seconds'      },
    { token: 'S', durationKey: 'milliseconds' },
];

// Read a potentially nested property from an object using dot notation
function getProperty(obj: any, path: string): any {
    return path.split('.').reduce((o: any, k: string) => o?.[k], obj);
}

// Write a potentially nested property to an object using dot notation
function setProperty(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    const last = parts.pop()!;
    const target = parts.reduce((o: any, k: string) => {
        if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
        return o[k];
    }, obj);
    target[last] = value;
}

// Parse an adjustment string into a Temporal.DurationLike
function parseAdjustmentString(str: string): Temporal.DurationLike {
    if (!str || str.trim() === '') return {};

    const s = str.replace(/\s+/g, '');
    const terms = s.split(/(?=[+-])/).filter(t => t.length > 0);
    const accumulated: Partial<Record<keyof Temporal.DurationLike, number>> = {};

    for (const term of terms) {
        const sign = term[0] === '-' ? -1 : 1;
        const body = (term[0] === '+' || term[0] === '-') ? term.slice(1) : term;

        if (body.length === 0)
            throw new Error(`Expected a number and unit after '${term[0]}'`);
        if (body.replace(/\d+[a-zA-Z]/g, '').length > 0)
            throw new Error(`Unexpected characters in '${term}'`);

        const pairPattern = /(\d+)([a-zA-Z])/g;
        let match: RegExpExecArray | null;
        while ((match = pairPattern.exec(body)) !== null) {
            const token = match[2];
            const unit = ADJUSTMENT_UNITS.find(u => u.token === token);
            if (!unit) {
                const supported = ADJUSTMENT_UNITS.map(u => u.token).join(', ');
                throw new Error(`Invalid unit '${token}'. Supported: ${supported}`);
            }
            accumulated[unit.durationKey] = (accumulated[unit.durationKey] ?? 0) + sign * parseInt(match[1], 10);
        }
    }

    return accumulated;
}

// Parse a string into a ZonedDateTime using a custom format string
function parseCustom(str: string, fmt: string, timezone: string): Temporal.ZonedDateTime {
    const fields: CustomField[] = [];
    let regexStr = '^';
    let i = 0;

    while (i < fmt.length) {
        let matched = false;
        for (const { token, field, pattern } of CUSTOM_TOKENS) {
            if (fmt.startsWith(token, i)) {
                regexStr += `(${pattern})`;
                fields.push(field);
                i += token.length;
                matched = true;
                break;
            }
        }
        if (!matched) {
            regexStr += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }

    const match = new RegExp(regexStr + '$').exec(str);
    if (!match) throw new Error(`Input '${str}' does not match custom format '${fmt}'`);

    let year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0, millisecond = 0;
    let hour12: number | null = null, ampm = 'AM';

    for (let j = 0; j < fields.length; j++) {
        const val = match[j + 1];
        switch (fields[j]) {
            case 'year':        year        = parseInt(val, 10); break;
            case 'yearShort':   year        = 2000 + parseInt(val, 10); break;
            case 'month':       month       = parseInt(val, 10); break;
            case 'day':         day         = parseInt(val, 10); break;
            case 'hour':        hour        = parseInt(val, 10); break;
            case 'hour12':      hour12      = parseInt(val, 10); break;
            case 'minute':      minute      = parseInt(val, 10); break;
            case 'second':      second      = parseInt(val, 10); break;
            case 'millisecond': millisecond = parseInt(val, 10); break;
            case 'ampm':        ampm        = val.toUpperCase(); break;
        }
    }

    if (hour12 !== null) {
        if      (ampm === 'PM' && hour12 !== 12) hour = hour12 + 12;
        else if (ampm === 'AM' && hour12 === 12) hour = 0;
        else                                     hour = hour12;
    }

    return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second, millisecond })
        .toZonedDateTime(timezone);
}

// Format a ZonedDateTime using a custom format string
function formatCustom(zdt: Temporal.ZonedDateTime, fmt: string): string {
    const h12 = zdt.hour % 12 || 12;
    let result = '';
    let i = 0;

    while (i < fmt.length) {
        let matched = false;
        for (const { token, field, pad } of CUSTOM_TOKENS) {
            if (fmt.startsWith(token, i)) {
                let val: number | string;
                switch (field) {
                    case 'year':        val = zdt.year;        break;
                    case 'yearShort':   val = zdt.year % 100;  break;
                    case 'month':       val = zdt.month;       break;
                    case 'day':         val = zdt.day;         break;
                    case 'hour':        val = zdt.hour;        break;
                    case 'hour12':      val = h12;             break;
                    case 'minute':      val = zdt.minute;      break;
                    case 'second':      val = zdt.second;      break;
                    case 'millisecond': val = zdt.millisecond; break;
                    case 'ampm':        val = token === 'A' ? (zdt.hour < 12 ? 'AM' : 'PM') : (zdt.hour < 12 ? 'am' : 'pm'); break;
                    default:            val = '';              break;
                }
                result += pad > 0 ? String(val).padStart(pad, '0') : String(val);
                i += token.length;
                matched = true;
                break;
            }
        }
        if (!matched) {
            result += fmt[i];
            i++;
        }
    }

    return result;
}

// Format a ZonedDateTime as RFC 2822
function formatRfc2822(zdt: Temporal.ZonedDateTime): string {
    const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const dow  = DAYS[new Date(zdt.epochMilliseconds).getUTCDay()];
    const dd   = String(zdt.day).padStart(2, '0');
    const mon  = MONTHS[zdt.month - 1];
    const HH   = String(zdt.hour).padStart(2, '0');
    const mm   = String(zdt.minute).padStart(2, '0');
    const ss   = String(zdt.second).padStart(2, '0');

    const offsetSecs = zdt.offsetNanoseconds / 1_000_000_000;
    const sign  = offsetSecs >= 0 ? '+' : '-';
    const absS  = Math.abs(offsetSecs);
    const offHH = String(Math.floor(absS / 3600)).padStart(2, '0');
    const offMM = String(Math.floor((absS % 3600) / 60)).padStart(2, '0');

    return `${dow}, ${dd} ${mon} ${zdt.year} ${HH}:${mm}:${ss} ${sign}${offHH}${offMM}`;
}

@NodeDescription({
    id: "TemporalTransformNode",
    name: "Temporal Transform",
    group: "temporal",
    sourceFile: SourceUtility.getSourcePath("/build/", "/src/") + "TemporalTransformNode.html",
    package: "@theotherwillembotha/node-red-temporal",
    dependencies: [TemporalService],
})
export class TemporalTransformNode extends BaseNode<TemporalTransformNodeConfig> {

    constructor(node: Node, config: TemporalTransformNodeConfig) {
        super(node, config);
    }

    @onInput()
    protected async onInput(message: any, _errorHandler: Function): Promise<void> {
        try {
            // 1. Parse input to ZonedDateTime
            const inputTimezone = this.resolveValue(message, this.config().inputTimezone, this.config().inputTimezoneType);
            const inputFormat   = this.resolveValue(message, this.config().inputFormat,   this.config().inputFormatType);
            const inputValue    = this.resolveValue(message, this.config().inputFrom,     this.config().inputFromType);
            const zdt = this.parseInput(inputValue, String(inputFormat), String(inputTimezone));

            // 2. Apply adjustment
            const adjustmentString = this.config().adjustmentString;
            const adjusted = adjustmentString?.trim()
                ? zdt.add(parseAdjustmentString(adjustmentString))
                : zdt;

            // 3. Convert to output timezone
            const outputTimezone = this.resolveValue(message, this.config().outputTimezone, this.config().outputTimezoneType);
            const zdtOut = adjusted.withTimeZone(String(outputTimezone));

            // 4. Format and write output
            const outputFormat = this.resolveValue(message, this.config().outputFormat, this.config().outputFormatType);
            this.writeOutput(message, this.formatOutput(zdtOut, String(outputFormat)));

            (this.node() as any).send(message);
        } catch (err: any) {
            console.log(err);
            this.node().warn(`TemporalTransform [${this.name()}]: ${err.message}`);
            // Drop the message — do not send
        }
    }

    // Resolve a typedInput field to its runtime value
    private resolveValue(message: any, value: string, type: string): any {
        switch (type) {
            case 'msg':    return getProperty(message, value);
            case 'flow':   return (this.node() as any).context().flow.get(value);
            case 'global': return (this.node() as any).context().global.get(value);
            case 'date':   return null;  // handled in parseInput
            default:       return value; // 'tz', 'preset', 'custom' — value IS the literal
        }
    }

    // Parse a raw value into a ZonedDateTime using the given format and timezone
    private parseInput(value: any, format: string, timezone: string): Temporal.ZonedDateTime {
        // "timestamp (now)" — ignore the input value entirely
        if (this.config().inputFromType === 'date') {
            return Temporal.Now.zonedDateTimeISO(timezone);
        }

        const str = String(value);

        switch (format) {
            case 'iso': {
                try {
                    return Temporal.ZonedDateTime.from(str);
                } catch {
                    return Temporal.Instant.from(str).toZonedDateTimeISO(timezone);
                }
            }
            case 'iso-utc':
                return Temporal.Instant.from(str).toZonedDateTimeISO(timezone);

            case 'date':
                return Temporal.PlainDate.from(str).toZonedDateTime({
                    timeZone:  timezone,
                    plainTime: Temporal.PlainTime.from('00:00:00'),
                });

            case 'datetime':
                return Temporal.PlainDateTime.from(str.replace(' ', 'T')).toZonedDateTime(timezone);

            case 'unix-s':
                return Temporal.Instant.fromEpochMilliseconds(Number(value) * 1000).toZonedDateTimeISO(timezone);

            case 'unix-ms':
                return Temporal.Instant.fromEpochMilliseconds(Number(value)).toZonedDateTimeISO(timezone);

            case 'rfc2822': {
                const ms = new Date(str).getTime();
                if (isNaN(ms)) throw new Error(`Could not parse RFC 2822 date: '${str}'`);
                return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timezone);
            }

            default:
                return parseCustom(str, format, timezone);
        }
    }

    // Format a ZonedDateTime for output
    private formatOutput(zdt: Temporal.ZonedDateTime, format: string): string | number {
        switch (format) {
            case 'iso':
                return zdt.toString();

            case 'iso-utc':
                return zdt.toInstant().toString();

            case 'date':
                return zdt.toPlainDate().toString();

            case 'datetime':
                return `${zdt.toPlainDate()} ${zdt.toPlainTime().toString({ smallestUnit: 'second' })}`;

            case 'unix-s':
                return Math.floor(zdt.epochMilliseconds / 1000);

            case 'unix-ms':
                return zdt.epochMilliseconds;

            case 'rfc2822':
                return formatRfc2822(zdt);

            default:
                return formatCustom(zdt, format);
        }
    }

    // Write the output value to the configured destination
    private writeOutput(message: any, value: any): void {
        switch (this.config().outputToType) {
            case 'msg':
                setProperty(message, this.config().outputTo, value);
                break;
            case 'flow':
                (this.node() as any).context().flow.set(this.config().outputTo, value);
                break;
            case 'global':
                (this.node() as any).context().global.set(this.config().outputTo, value);
                break;
        }
    }
}
