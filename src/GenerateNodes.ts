import { NodeGenerator } from "@theotherwillembotha/node-red-plugincore"

// services.
import { TemporalService } from "./temporal/service/TemporalService";

// nodes.
import { TemporalTransformNode } from "./temporal/node/TemporalTransformNode";
import { TemporalDurationNode } from "./temporal/node/TemporalDurationNode";


new NodeGenerator("./src/")
    // services.
    .registerService(TemporalService)

    // nodes.
    .registerNode(TemporalTransformNode)
    .registerNode(TemporalDurationNode)

    // done.
    .generate("./build/Nodes", "./build/Plugins", "@theotherwillembotha/node-red-temporal");

process.exit(0);
