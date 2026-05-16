import { Temporal } from 'temporal-polyfill';
import { Node } from "node-red";
import { BaseNode, BaseNodeConfig, NodeDescription, onInput } from "@theotherwillembotha/node-red-plugincore";
import { SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { NAMED_FORMATS, TemporalService } from "../service/TemporalService";

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

// Custom format tokens (ordered longest-first to prevent partial matches e.g. MM before M)
type CustomParseState = {
    year: number; month: number; day: number;
    hour: number; hour12: number | null;
    minute: number; second: number; millisecond: number;
    ampm: string;
};
type CustomToken = {
    token:   string;
    pattern: string;
    parse:   (val: string, state: CustomParseState) => void;
    format:  (zdt: Temporal.ZonedDateTime) => string;
};
const CUSTOM_TOKENS: CustomToken[] = [
    { token: 'YYYY', pattern: '\\d{4}',   parse: (v, s) => { s.year        = parseInt(v, 10);        }, format: (z) => String(z.year).padStart(4, '0')             },
    { token: 'YY',   pattern: '\\d{2}',   parse: (v, s) => { s.year        = 2000 + parseInt(v, 10); }, format: (z) => String(z.year % 100).padStart(2, '0')       },
    { token: 'MM',   pattern: '\\d{1,2}', parse: (v, s) => { s.month       = parseInt(v, 10);        }, format: (z) => String(z.month).padStart(2, '0')            },
    { token: 'DD',   pattern: '\\d{1,2}', parse: (v, s) => { s.day         = parseInt(v, 10);        }, format: (z) => String(z.day).padStart(2, '0')              },
    { token: 'HH',   pattern: '\\d{1,2}', parse: (v, s) => { s.hour        = parseInt(v, 10);        }, format: (z) => String(z.hour).padStart(2, '0')             },
    { token: 'hh',   pattern: '\\d{1,2}', parse: (v, s) => { s.hour12      = parseInt(v, 10);        }, format: (z) => String(z.hour % 12 || 12).padStart(2, '0') },
    { token: 'mm',   pattern: '\\d{1,2}', parse: (v, s) => { s.minute      = parseInt(v, 10);        }, format: (z) => String(z.minute).padStart(2, '0')           },
    { token: 'ss',   pattern: '\\d{1,2}', parse: (v, s) => { s.second      = parseInt(v, 10);        }, format: (z) => String(z.second).padStart(2, '0')           },
    { token: 'SSS',  pattern: '\\d{1,3}', parse: (v, s) => { s.millisecond = parseInt(v, 10);        }, format: (z) => String(z.millisecond).padStart(3, '0')      },
    { token: 'M',    pattern: '\\d{1,2}', parse: (v, s) => { s.month       = parseInt(v, 10);        }, format: (z) => String(z.month)                             },
    { token: 'D',    pattern: '\\d{1,2}', parse: (v, s) => { s.day         = parseInt(v, 10);        }, format: (z) => String(z.day)                               },
    { token: 'H',    pattern: '\\d{1,2}', parse: (v, s) => { s.hour        = parseInt(v, 10);        }, format: (z) => String(z.hour)                              },
    { token: 'h',    pattern: '\\d{1,2}', parse: (v, s) => { s.hour12      = parseInt(v, 10);        }, format: (z) => String(z.hour % 12 || 12)                   },
    { token: 'm',    pattern: '\\d{1,2}', parse: (v, s) => { s.minute      = parseInt(v, 10);        }, format: (z) => String(z.minute)                            },
    { token: 's',    pattern: '\\d{1,2}', parse: (v, s) => { s.second      = parseInt(v, 10);        }, format: (z) => String(z.second)                            },
    { token: 'A',    pattern: 'AM|PM',    parse: (v, s) => { s.ampm        = v.toUpperCase();        }, format: (z) => z.hour < 12 ? 'AM' : 'PM'                   },
    { token: 'a',    pattern: 'am|pm',    parse: (v, s) => { s.ampm        = v.toUpperCase();        }, format: (z) => z.hour < 12 ? 'am' : 'pm'                   },
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

// Walk a format string, calling onToken for each matched token and onLiteral for each unmatched char
function walkFormat(fmt: string, onToken: (t: CustomToken) => void, onLiteral: (ch: string) => void): void {
    let i = 0;
    while (i < fmt.length) {
        let matched = false;
        for (const t of CUSTOM_TOKENS) {
            if (fmt.startsWith(t.token, i)) {
                onToken(t);
                i += t.token.length;
                matched = true;
                break;
            }
        }
        if (!matched) { onLiteral(fmt[i]); i++; }
    }
}

// Parse a string into a ZonedDateTime using a custom format string
function parseCustom(str: string, fmt: string, timezone: string): Temporal.ZonedDateTime {
    const tokenRefs: CustomToken[] = [];
    let regexStr = '^';

    walkFormat(fmt,
        (t) => { regexStr += `(${t.pattern})`; tokenRefs.push(t); },
        (ch) => { regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
    );

    const match = new RegExp(regexStr + '$').exec(str);
    if (!match) throw new Error(`Input '${str}' does not match custom format '${fmt}'`);

    const state: CustomParseState = {
        year: 0, month: 1, day: 1,
        hour: 0, hour12: null,
        minute: 0, second: 0, millisecond: 0,
        ampm: 'AM',
    };
    tokenRefs.forEach((t, j) => t.parse(match[j + 1], state));

    if (state.hour12 !== null) {
        if      (state.ampm === 'PM' && state.hour12 !== 12) state.hour = state.hour12 + 12;
        else if (state.ampm === 'AM' && state.hour12 === 12) state.hour = 0;
        else                                                 state.hour = state.hour12;
    }

    return Temporal.PlainDateTime.from({
        year: state.year, month: state.month, day: state.day,
        hour: state.hour, minute: state.minute, second: state.second, millisecond: state.millisecond,
    }).toZonedDateTime(timezone);
}

// Format a ZonedDateTime using a custom format string
function formatCustom(zdt: Temporal.ZonedDateTime, fmt: string): string {
    let result = '';
    walkFormat(fmt, (t) => { result += t.format(zdt); }, (ch) => { result += ch; });
    return result;
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
            // 1. Resolve the input and output config.
            const inputTimezone = String(this.resolveValue(message, this.config().inputTimezone, this.config().inputTimezoneType));
            const inputFormat   = String(this.resolveValue(message, this.config().inputFormat,   this.config().inputFormatType));
            const inputValue    = String(this.resolveValue(message, this.config().inputFrom,     this.config().inputFromType));

            const outputTimezone = String(this.resolveValue(message, this.config().outputTimezone, this.config().outputTimezoneType));
            const outputFormat = String(this.resolveValue(message, this.config().outputFormat, this.config().outputFormatType));

            // 2. Parse the input values.
            const zdt = NAMED_FORMATS[inputFormat] 
                ? NAMED_FORMATS[inputFormat].parse(inputValue, inputTimezone) 
                : parseCustom(inputValue, inputFormat, inputTimezone);

            // 3. Apply adjustment
            const adjustmentString = this.config().adjustmentString;
            const adjusted = adjustmentString?.trim()
                ? zdt.add(parseAdjustmentString(adjustmentString))
                : zdt;

            // 4. apply timezone and format.
            const TimezonedOutput = adjusted.withTimeZone(outputTimezone);
            const output = NAMED_FORMATS[outputFormat]
                ? NAMED_FORMATS[outputFormat].format(TimezonedOutput) 
                : formatCustom(TimezonedOutput, outputFormat);
            
            // 5. Write output.
            this.writeOutput(message, output);
            this.node().send(message);

        } 
        catch (err: any) {
            console.log(err);
            this.node().warn(`TemporalTransform [${this.name()}]: ${err.message}`);
            // Drop the message, do not send
        }
    }

    // Resolve a typedInput field to its runtime value
    private resolveValue(message: any, value: string, type: string): any {
        switch (type) {
            case 'msg':    return getProperty(message, value);
            case 'flow':   return (this.node() as any).context().flow.get(value);
            case 'global': return (this.node() as any).context().global.get(value);
            case 'date':   return Date.now();
            default:       return value;
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
