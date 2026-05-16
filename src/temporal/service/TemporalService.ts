import { BaseService, FlowDeployment, ServiceDescriptor } from "@theotherwillembotha/node-red-plugincore";
import { NodeAPI, NodeAPISettingsWithData } from "node-red";

export class TemporalService extends BaseService {

    constructor() {
        super("temporalservice");
    }

    public init(red: NodeAPI<NodeAPISettingsWithData>): void | Promise<void> {
        red.httpAdmin.get("/temporal/timezones", (_request, response) => {
            response.json(Intl.supportedValuesOf('timeZone'));
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
