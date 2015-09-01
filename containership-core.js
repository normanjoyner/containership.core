var fs = require("fs");
var _ = require("lodash");
var async = require("async");
var resources = require([__dirname, "lib", "resources"].join("/"));
var plugins = require([__dirname, "lib", "plugins"].join("/"));
var Logger = require([__dirname, "lib", "logger"].join("/"));
var Cluster = require([__dirname, "lib", "cluster"].join("/"));
var Applications = require([__dirname, "lib", "applications"].join("/"));
var constants = require([__dirname, "lib", "constants"].join("/"));

// define ContainershipCore
function ContainershipCore(options){
    this.load_options(options || {});
}

// initialize ContainershipCore
ContainershipCore.prototype.initialize = function(){
    var self = this;

    this.constants = constants;

    // initialize logger
    this.loggers = {};
    this.logger = new Logger(this);
    this.logger.register("containership.core");

    // initialize applications
    if(this.options.mode == "leader")
        this.applications = new Applications(this);

    this.loggers["containership.core"].log("info", ["Containership version", this.options.version , "started in", this.options.mode, "mode!"].join(" "));

    // initialize cluster
    this.cluster = new Cluster(this);
    this.cluster.initialize(function(){
        self.scheduler.load_core(self);

        if(self.options.mode == "leader"){
            self.api.load_core(self);
            self.api.server.start(self.options);
        }

        plugins.initialize(self);
        plugins.load();

        process.on("SIGHUP", plugins.reload);

        process.on("SIGTERM", function(){
            self.cluster.legiond.exit(function(){
                process.exit(0);
            });
        });

        process.on("SIGINT", function(){
            self.cluster.legiond.exit(function(){
                process.exit(0);
            });
        });
    });
}

// load and set configuration
ContainershipCore.prototype.load_options = function(options){
    options = _.merge(options, {
        praetor: {
            leader_eligible: false
        },
        legiond: {
            network: {},
            attributes: {
                mode: "follower"
            }
        },
        channels: []
    });

    options.legiond.network.cidr = options.cidr;
    options.legiond.network.public = options["legiond-scope"] == "public";

    if(_.has(options, "legiond-interface"))
        options.legiond.network.interface = options["legiond-interface"];

    if(_.has(options, "cluster-id"))
        options.cluster_id = options["cluster-id"]

    if(options.mode == "leader"){
        options.legiond.attributes.mode = "leader";
        options.praetor.leader_eligible = true;
        options.legiond.attributes.tags = {};
        _.each(options.tag, function(tag){
            options.legiond.attributes.tags[tag.tag] = tag.value;
        });
        options.channels = [
            constants.events.CLUSTER_ID
        ]
    }
    else{
        options.legiond.attributes.engines = {};
        options.legiond.attributes.tags = {};
        _.each(options.tag, function(tag){
            options.legiond.attributes.tags[tag.tag] = tag.value;
        });
        options.channels = [
            constants.events.CLUSTER_ID,
            constants.events.RECONCILE,
            constants.events.LOAD_CONTAINER,
            constants.events.UNLOAD_CONTAINER,
            constants.events.UPDATE_HOST,
            constants.events.DELETE_HOST
        ]

        options.legiond.attributes.memory = resources.get_memory();
        options.legiond.attributes.cpus = resources.get_cpus();
    }

    options.legiond.attributes.metadata = {
        containership: {
            version: options.version
        }
    }

    options.persistence = {
        max_coalescing_duration: 1024,
        data_directory: ["", "tmp"].join("/"),
        snapshot_name: "containership.snapshot"
    }

    this.options = options;
}

module.exports = ContainershipCore;
