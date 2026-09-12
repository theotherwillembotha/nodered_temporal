const esbuild = require('esbuild');
const path = require('path');

// Packages that must remain as require() calls at runtime in the container.
// Everything else (including plugincore) gets bundled inline.
const external = [
    // Real temporal runtime deps - installed via npm in the container
    'node-red',
    'temporal-polyfill',
    '@formatjs/intl-durationformat',
    // plugincore build-time deps - lazy require()s, not needed in the container
    'jsdom',
    'js-beautify',
    'markdown-it',
    // plugincore optional service deps - not used by temporal at runtime
    'winston',
    'winston-loki',
    'prom-client',
    'deep-equal',
    'whatwg-url',
    'express',
    'body-parser',
];

const sharedConfig = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    external,
    format: 'cjs',
    // Nodes.js does require("@theotherwillembotha/node-red-temporal") (self-reference).
    // Alias it to the local build output so esbuild can bundle it inline.
    alias: {
        '@theotherwillembotha/node-red-temporal': path.resolve('./build/index.js'),
    },
};

async function build() {
    await esbuild.build({
        ...sharedConfig,
        entryPoints: ['build/Nodes.js'],
        outfile: 'build/Nodes.js',
        allowOverwrite: true,
    });
    console.log('Bundled Nodes.js');

    await esbuild.build({
        ...sharedConfig,
        entryPoints: ['build/Plugins.js'],
        outfile: 'build/Plugins.js',
        allowOverwrite: true,
    });
    console.log('Bundled Plugins.js');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
