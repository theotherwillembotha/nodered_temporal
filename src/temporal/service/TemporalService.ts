import { Temporal } from 'temporal-polyfill';
import { BaseService, FlowDeployment, ServiceDescriptor } from "@theotherwillembotha/node-red-plugincore";
import { NodeAPI, NodeAPISettingsWithData } from "node-red";

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type NamedFormat = {
    label:  string;
    parse:  (str: string, timezone: string) => Temporal.ZonedDateTime;
    format: (zdt: Temporal.ZonedDateTime)   => string | number | Date;
};

export const NAMED_FORMATS: Record<string, NamedFormat> = {
    'iso': {
        label:  'ISO 8601 with offset (2024-05-16T14:30:00+02:00)',
        parse:  (str, timezone) => {
            try { return Temporal.ZonedDateTime.from(str); }
            catch { return Temporal.Instant.from(str).toZonedDateTimeISO(timezone); }
        },
        format: (zdt) => zdt.toString(),
    },
    'iso-utc': {
        label:  'ISO 8601 UTC (2024-05-16T12:30:00.000Z)',
        parse:  (str, timezone) => Temporal.Instant.from(str).toZonedDateTimeISO(timezone),
        format: (zdt) => zdt.toInstant().toString(),
    },
    'date': {
        label:  'Date only (2024-05-16)',
        parse:  (str, timezone) => Temporal.PlainDate.from(str).toZonedDateTime({
            timeZone:  timezone,
            plainTime: Temporal.PlainTime.from('00:00:00'),
        }),
        format: (zdt) => zdt.toPlainDate().toString(),
    },
    'datetime': {
        label:  'Date + Time (2024-05-16 14:30:00)',
        parse:  (str, timezone) => Temporal.PlainDateTime.from(str.replace(' ', 'T')).toZonedDateTime(timezone),
        format: (zdt) => `${zdt.toPlainDate()} ${zdt.toPlainTime().toString({ smallestUnit: 'second' })}`,
    },
    'unix-s': {
        label:  'seconds since epoch',
        parse:  (str, timezone) => Temporal.Instant.fromEpochMilliseconds(Number(str) * 1000).toZonedDateTimeISO(timezone),
        format: (zdt) => Math.floor(zdt.epochMilliseconds / 1000),
    },
    'unix-ms': {
        label:  'milliseconds since epoch',
        parse:  (str, timezone) => Temporal.Instant.fromEpochMilliseconds(Number(str)).toZonedDateTimeISO(timezone),
        format: (zdt) => zdt.epochMilliseconds,
    },
    'js-date': {
        label:  'JavaScript Date Object',
        parse:  (str, timezone) => {
            const ms = new Date(str).getTime();
            if (isNaN(ms)) throw new Error(`Could not parse JavaScript Date: '${str}'`);
            return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timezone);
        },
        format: (zdt) => new Date(zdt.epochMilliseconds),
    },
    'rfc2822': {
        label:  'RFC 2822 (Thu, 16 May 2024 14:30:00 +0200)',
        parse:  (str, timezone) => {
            const ms = new Date(str).getTime();
            if (isNaN(ms)) throw new Error(`Could not parse RFC 2822 date: '${str}'`);
            return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timezone);
        },
        format: (zdt) => {
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
        },
    },
};

export class TemporalService extends BaseService {

    constructor() {
        super("temporalservice");
    }

    public init(red: NodeAPI<NodeAPISettingsWithData>): void | Promise<void> {
        red.httpAdmin.get("/temporal/timezones", (_request, response) => {
            response.json(Intl.supportedValuesOf('timeZone'));
        });

        red.httpAdmin.get("/temporal/formats", (_request, response) => {
            response.json(Object.entries(NAMED_FORMATS).map(([value, f]) => ({ value, label: f.label })));
        });
        return Promise.resolve();
    }

    public deinit(_red: NodeAPI<NodeAPISettingsWithData>): void | Promise<void> {
        return Promise.resolve();
    }

    public onDeploy(_flowDeployment: FlowDeployment): void | Promise<void> {
    }

    static override getServiceDescriptor(): ServiceDescriptor {
        return new ServiceDescriptor(
            "@theotherwillembotha/temporalservice",
            "TemporalService",
            "services-plugin",
            "@theotherwillembotha/node-red-temporal",
            TemporalService,
            []
        );
    }
}
