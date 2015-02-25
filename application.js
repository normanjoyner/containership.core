var _ = require("lodash");
var ContainershipCore = require([__dirname, "containership-core"].join("/"));
var pkg = require([__dirname, "package"].join("/"));
var opts = require([__dirname, "options"].join("/"));

module.exports = function(options){
    var core = new ContainershipCore();
    core.version = pkg.version;

    if(_.has(options, "scheduler")){
        core.scheduler = options.scheduler;
        _.defaults(opts, core.scheduler.options);
    }
    else
        process.exit(1);


    if(_.has(options, "api")){
        core.api = options.api;
        _.defaults(opts, core.api.options);
    }
    else
        process.exit(1);

    core.options = opts;
    return core;
}
