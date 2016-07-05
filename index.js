'use strict';

const ContainershipCore = require('./containership-core');
const pkg = require('./package.json');
const opts = require('./options');

const _ = require('lodash');

module.exports = function(options) {
    const core = new ContainershipCore({
        version: pkg.version
    });

    core.version = pkg.version;

    if(_.has(options, 'scheduler')) {
        core.scheduler = options.scheduler;
        _.defaults(opts, core.scheduler.options);
    } else {
        process.exit(1);
    }

    if(_.has(options, 'api')) {
        core.api = options.api;
        _.defaults(opts, core.api.options);
    } else {
        process.exit(1);
    }

    core.options = opts;
    return core;
};
