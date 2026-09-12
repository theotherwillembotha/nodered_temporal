import '@formatjs/intl-durationformat/polyfill.js';
import { Temporal } from 'temporal-polyfill';
import { Node } from "node-red";
import { BaseNode, BaseNodeConfig, BasicTemplate, NodeDescription, onInput, SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { TemporalService } from "../service/TemporalService";
import { getProperty, setProperty, parseToZdt, parseAdjustmentString } from "../TemporalUtils";

export interface TemporalDurationNodeConfig extends BaseNodeConfig {
    // From
    fromValue: string;
    fromValueType: string;
    fromFormat: string;
    fromFormatType: string;
    fromTimezone: string;
    fromTimezoneType: string;

    // To
    toValue: string;
    toValueType: string;
    toFormat: string;
    toFormatType: string;
    toTimezone: string;
    toTimezoneType: string;

    // Offset
    adjustmentString: string;

    // Output
    outputMode: 'total' | 'components' | 'iso' | 'human';
    outputUnit: string;
    outputLargestUnit: string;
    outputStyle: string;
    outputTo: string;
    outputToType: string;
}

@NodeDescription({
    id: "TemporalDurationNode",
    name: "Temporal Duration",
    group: "temporal",
    sourceFile: SourceUtility.getSourcePath("/build/", "/src/") + "TemporalDurationNode.html",
    package: "@theotherwillembotha/node-red-temporal",
    dependencies: [TemporalService],
    templates: [
        { template: BasicTemplate, config: {} }
    ],
})
export class TemporalDurationNode extends BaseNode<TemporalDurationNodeConfig> {

    private _previousZdt: Temporal.ZonedDateTime | null = null;

    constructor(node: Node, config: TemporalDurationNodeConfig) {
        super(node, config);
    }

    @onInput()
    protected async onInput(message: any, _errorHandler: Function): Promise<void> {
        try {
            const isIntervalMode = this.config().fromValueType === 'previous';

            // Always resolve "To" - this is the "current" time in all modes
            const toZdt = this.resolveZdt(
                message,
                this.config().toValue,    this.config().toValueType,
                this.config().toFormat,   this.config().toFormatType,
                this.config().toTimezone, this.config().toTimezoneType,
            );

            let fromZdt: Temporal.ZonedDateTime;

            if (isIntervalMode) {
                const prev = this._previousZdt;
                this._previousZdt = toZdt;
                if (prev === null) {
                    // First message - store the time and drop the message
                    return;
                }
                fromZdt = prev;
            } else {
                fromZdt = this.resolveZdt(
                    message,
                    this.config().fromValue,    this.config().fromValueType,
                    this.config().fromFormat,   this.config().fromFormatType,
                    this.config().fromTimezone, this.config().fromTimezoneType,
                );
            }

            const output = this.computeOutput(fromZdt, toZdt);
            this.writeOutput(message, output);
            this.node().send(message);
        }
        catch (err: any) {
            this.node().warn(`TemporalDuration [${this.name()}]: ${err.message}`);
        }
    }

    private resolveZdt(
        message: any,
        value: string, valueType: string,
        format: string, formatType: string,
        timezone: string, timezoneType: string,
    ): Temporal.ZonedDateTime {
        const resolvedTimezone = String(this.resolveValue(message, timezone, timezoneType));

        if (valueType === 'date') {
            return Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(resolvedTimezone);
        }

        const resolvedValue  = String(this.resolveValue(message, value, valueType));
        const resolvedFormat = String(this.resolveValue(message, format, formatType));
        return parseToZdt(resolvedValue, resolvedFormat, resolvedTimezone);
    }

    private computeOutput(fromZdt: Temporal.ZonedDateTime, toZdt: Temporal.ZonedDateTime): any {
        const mode = this.config().outputMode;

        // Compute base duration, then apply offset if set
        let duration: any = fromZdt.until(toZdt, { largestUnit: 'years' } as any);
        const adjustmentString = this.config().adjustmentString?.trim();
        if (adjustmentString) {
            const offset = parseAdjustmentString(adjustmentString);
            duration = duration.add(offset, { relativeTo: fromZdt });
            // Re-balance so all fields are properly distributed
            duration = duration.round({ largestUnit: 'years', relativeTo: fromZdt });
        }

        switch (mode) {
            case 'total': {
                const unit = this.config().outputUnit || 'millisecond';
                return duration.total({ unit, relativeTo: fromZdt });
            }

            case 'components': {
                const largestUnit = this.config().outputLargestUnit || 'hour';
                const d = duration.round({ largestUnit, relativeTo: fromZdt });
                return {
                    years:        d.years,
                    months:       d.months,
                    weeks:        d.weeks,
                    days:         d.days,
                    hours:        d.hours,
                    minutes:      d.minutes,
                    seconds:      d.seconds,
                    milliseconds: d.milliseconds,
                };
            }

            case 'iso': {
                return duration.toString();
            }

            case 'human': {
                const style = (this.config().outputStyle || 'long') as 'long' | 'short' | 'narrow';
                const durationLike: Record<string, number> = {
                    years:        duration.years,
                    months:       duration.months,
                    weeks:        duration.weeks,
                    days:         duration.days,
                    hours:        duration.hours,
                    minutes:      duration.minutes,
                    seconds:      duration.seconds,
                    milliseconds: duration.milliseconds,
                };
                const nonZero = Object.fromEntries(
                    Object.entries(durationLike).filter(([, v]) => v !== 0)
                );
                if (Object.keys(nonZero).length === 0) return '0 seconds';
                return new (Intl as any).DurationFormat('en', { style }).format(nonZero);
            }

            default:
                throw new Error(`Unknown output mode: ${mode}`);
        }
    }

    private resolveValue(message: any, value: string, type: string): any {
        switch (type) {
            case 'msg':    return getProperty(message, value);
            case 'flow':   return (this.node() as any).context().flow.get(value);
            case 'global': return (this.node() as any).context().global.get(value);
            case 'date':   return Date.now();
            default:       return value;
        }
    }

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
