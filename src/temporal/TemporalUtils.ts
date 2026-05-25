import { Temporal } from 'temporal-polyfill';
import { NAMED_FORMATS } from './service/TemporalService';

// Custom format tokens (ordered longest-first to prevent partial matches e.g. MM before M)
export type CustomParseState = {
    year: number; month: number; day: number;
    hour: number; hour12: number | null;
    minute: number; second: number; millisecond: number;
    ampm: string;
};

export type CustomToken = {
    token:   string;
    pattern: string;
    parse:   (val: string, state: CustomParseState) => void;
    format:  (zdt: Temporal.ZonedDateTime) => string;
};

export const CUSTOM_TOKENS: CustomToken[] = [
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

// Read a potentially nested property from an object using dot notation
export function getProperty(obj: any, path: string): any {
    return path.split('.').reduce((o: any, k: string) => o?.[k], obj);
}

// Write a potentially nested property to an object using dot notation
export function setProperty(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    const last = parts.pop()!;
    const target = parts.reduce((o: any, k: string) => {
        if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
        return o[k];
    }, obj);
    target[last] = value;
}

// Walk a format string, calling onToken for each matched token and onLiteral for each unmatched char
export function walkFormat(fmt: string, onToken: (t: CustomToken) => void, onLiteral: (ch: string) => void): void {
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
export function parseCustom(str: string, fmt: string, timezone: string): Temporal.ZonedDateTime {
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
export function formatCustom(zdt: Temporal.ZonedDateTime, fmt: string): string {
    let result = '';
    walkFormat(fmt, (t) => { result += t.format(zdt); }, (ch) => { result += ch; });
    return result;
}

// Adjustment unit tokens mapped to their Temporal.Duration property names
export const ADJUSTMENT_UNITS: { token: string; durationKey: keyof Temporal.DurationLike }[] = [
    { token: 'y', durationKey: 'years'        },
    { token: 'M', durationKey: 'months'       },
    { token: 'w', durationKey: 'weeks'        },
    { token: 'd', durationKey: 'days'         },
    { token: 'H', durationKey: 'hours'        },
    { token: 'm', durationKey: 'minutes'      },
    { token: 's', durationKey: 'seconds'      },
    { token: 'S', durationKey: 'milliseconds' },
];

// Parse an adjustment string into a Temporal.DurationLike
export function parseAdjustmentString(str: string): Temporal.DurationLike {
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

// Parse a value string to a ZonedDateTime using a named or custom format
export function parseToZdt(inputValue: string, inputFormat: string, inputTimezone: string): Temporal.ZonedDateTime {
    return NAMED_FORMATS[inputFormat]
        ? NAMED_FORMATS[inputFormat].parse(inputValue, inputTimezone)
        : parseCustom(inputValue, inputFormat, inputTimezone);
}
