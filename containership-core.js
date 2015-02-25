var fs = require("fs");
var _ = require("lodash");
var async = require("async");
var resources = require([__dirname, "lib", "resources"].join("/"));
var plugins = require([__dirname, "lib", "plugins"].join("/"));
var Logger = require([__dirname, "lib", "logger"].join("/"));
var Cluster = require([__dirname, "lib", "cluster"].join("/"));
var Persistence = require([__dirname, "lib", "persistence"].join("/"));
var Applications = require([__dirname, "lib", "applications"].join("/"));
var Hosts = require([__dirname, "lib", "hosts"].join("/"));

// define ContainershipCore
function ContainershipCore(options){
    this.load_options(options || {});
}

// initialize ContainershipCore
ContainershipCore.prototype.initialize = function(){
    var self = this;

    // initialize logger
    this.loggers = {};
    this.logger = new Logger(this);
    this.logger.register("containership.core");

    // initialize persistence
    if(this.options.mode == "leader"){
        this.persistence = new Persistence(this);
        this.applications = new Applications(this);
        this.hosts = new Hosts(this);
    }

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

    if(options.mode == "leader"){
        options.legiond.attributes.mode = "leader";
        options.praetor.leader_eligible = true;
        options.legiond.attributes.tags = {};
        _.each(options.tag, function(tag){
            options.legiond.attributes.tags[tag.tag] = tag.value;
        });
        options.channels = [
            "applications.reconciled",
            "applications.sync",
            "cluster.state",
            "container.loaded",
            "container.unloaded"
        ]
    }
    else{
        options.legiond.attributes.engines = {};
        options.legiond.attributes.tags = {};
        _.each(options.tag, function(tag){
            options.legiond.attributes.tags[tag.tag] = tag.value;
        });
        options.channels = [
            "applications.reconcile",
            "cluster.state",
            "container.load",
            "container.unload",
            "host.update",
            "host.delete"
        ]

        options.legiond.attributes.memory = resources.get_memory();
        options.legiond.attributes.cpus = resources.get_cpus();
    }

    this.options = options;
}

module.exports = ContainershipCore;
