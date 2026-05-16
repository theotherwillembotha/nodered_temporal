import { NodeGenerator } from "@theotherwillembotha/node-red-plugincore"

// services.
import { TemporalService } from "./temporal/service/TemporalService";

// nodes.
import { TemporalTransformNode } from "./temporal/node/TemporalTransformNode";


new NodeGenerator("./src/")
    // services.
    .registerService(TemporalService)

    // nodes.
    .registerNode(TemporalTransformNode)

    // done.
    .generate("./build/Nodes", "./build/Plugins");

process.exit(0);
