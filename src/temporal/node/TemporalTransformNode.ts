import { Temporal } from 'temporal-polyfill';
import { Node } from "node-red";
import { BaseNode, BaseNodeConfig, BasicTemplate, NodeDescription, onInput } from "@theotherwillembotha/node-red-plugincore";
import { SourceUtility } from "@theotherwillembotha/node-red-plugincore";
import { NAMED_FORMATS, TemporalService } from "../service/TemporalService";
import { getProperty, setProperty, parseCustom, formatCustom, parseAdjustmentString } from "../TemporalUtils";

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



@NodeDescription({
    id: "TemporalTransformNode",
    name: "Temporal Transform",
    group: "temporal",
    sourceFile: SourceUtility.getSourcePath("/build/", "/src/") + "TemporalTransformNode.html",
    package: "@theotherwillembotha/node-red-temporal",
    dependencies: [TemporalService],
    templates: [
        { template: BasicTemplate, config: {} }
    ],
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
