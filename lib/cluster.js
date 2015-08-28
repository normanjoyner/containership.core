var fs = require("fs");
var _ = require("lodash");
var async = require("async");
var Myriad = require("myriad-kv");
var constants = require([__dirname, "constants"].join("/"));
var crypto = require([__dirname, "crypto"].join("/"));

function Cluster(core){
    this.core = core;
    this.core.logger.register("myriad-kv");

    var options = {
        leader_eligible: core.options.praetor.leader_eligible,
        legiond: core.options.legiond,
        persistence: core.options.persistence,
        logger: this.core.loggers["myriad-kv"]
    }

    options.legiond.attributes.start_time = new Date().valueOf();

    this.myriad = new Myriad(options);
}

Cluster.prototype.initialize = function(fn){
    var self = this;

    // wait until legiond is listening within myriad
    this.myriad.listen(function(){
        self.praetor = self.myriad.cluster.praetor;
        self.legiond = self.myriad.cluster.legiond;

        self.set_id(fn);

        // join channels
        _.each(self.core.options.channels, function(channel){
            self.legiond.join(channel);
        }, self);

        self.praetor.on("error", function(){});

        // handle promotion
        self.legiond.on("promoted", function(data){
            self.core.loggers["containership.core"].log("info", "Promoted to controlling leader!");

            var peers = self.legiond.get_peers();
            self.core.loggers["containership.core"].log("verbose", ["Controlling cluster of", _.values(peers).length, "nodes"].join(" "));
            _.each(peers, function(host, id){
                self.core.loggers["containership.core"].log("debug", ["Found", host.mode, "node:", id].join(" "));
            });

            setTimeout(function(){
                if(self.praetor.is_controlling_leader())
                    self.core.scheduler.harmonize();
            }, 15000);
        });

        // handle myriad bootstrapping from snapshot
        self.legiond.on("myriad.bootstrapped", function(){
            setTimeout(function(){
                self.core.applications.bootstrap();
            }, 2000);
        });

        // handle demotion
        self.legiond.on("demoted", function(){
            self.core.loggers["containership.core"].log("info", "Demoted from controlling leader!");
            self.core.scheduler.deharmonize();
        });

        // handle new nodes
        self.legiond.on("node_added", function(node){
            if(self.praetor.is_controlling_leader())
                self.core.loggers["containership.core"].log("info", ["Added node", node.host_name].join(" "));
        });

        // handle removed nodes
        self.legiond.on("node_removed", function(node){
            if(self.praetor.is_controlling_leader()){
                self.core.loggers["containership.core"].log("info", ["Removed node", node.host_name].join(" "));
                self.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, "*", "*"].join("::"), function(err, container_names){
                    var containers = [];

                    async.each(container_names, function(container_name, fn){
                        self.myriad.persistence.get(container_name, function(err, container){
                            if(_.isNull(err)){
                                try{
                                    container = JSON.parse(container);
                                    container.application = container_name.split("::")[2];
                                    if(container.host == node.id)
                                        containers.push(container);

                                    return fn();
                                }
                                catch(err){
                                    return fn();
                                }
                            }
                            else
                                return fn();
                        });
                    }, function(){
                        async.each(containers, function(container, fn){
                            self.core.applications.unload_containers(container.application, container.id, fn);
                        }, fn);
                    });
                });
            }
        });

        // handle loading containers
        self.legiond.on(constants.events.LOAD_CONTAINER, function(message){
            self.core.scheduler.follower.container.start(message.data);
        });

        // handle unloading containers
        self.legiond.on(constants.events.UNLOAD_CONTAINER, function(message){
            self.core.scheduler.follower.container.stop(message.data);
        });

        // handle reconciling running application containers
        self.legiond.on(constants.events.RECONCILE, function(message){
            self.core.scheduler.follower.container.reconcile(message.author);
        });

        // set the cluster id
        self.legiond.on(constants.events.CLUSTER_ID, function(){
            self.set_id();
        });

        // update host
        self.legiond.on(constants.events.UPDATE_HOST, function(message){
            self.core.loggers["containership.core"].log("info", "Updating host with new tags");
            self.legiond.set_attributes({
                tags: message.data
            });
        });

        // delete host
        self.legiond.on(constants.events.DELETE_HOST, function(){
            self.core.loggers["containership.core"].log("info", "Host shutdown requested. Shutting down ...");
            self.legiond.exit(function(){
                process.exit(0);
            });
        });
    });
}

Cluster.prototype.generate_id = function(fn){
    this.myriad.persistence.set(constants.myriad.CLUSTER_ID, crypto.generate_uuid(16), fn);
}

Cluster.prototype.set_id = function(fn){
    var self = this;
    this.myriad.persistence.get(constants.myriad.CLUSTER_ID, function(err, cluster_id){
        if(_.isNull(err))
            self.core.cluster_id = cluster_id;

        return fn(err);
    });
}

module.exports = Cluster;
