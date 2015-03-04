var fs = require("fs");
var _ = require("lodash");
var async = require("async");
var Praetor = require("praetor");

function Cluster(core){
    this.core = core;
    var options = {
        leader_eligible: core.options.praetor.leader_eligible,
        legiond: core.options.legiond
    }

    options.legiond.attributes.start_time = new Date().valueOf();

    this.praetor = new Praetor(options);
    this.legiond = this.praetor.legiond;
}

Cluster.prototype.initialize = function(fn){
    var self = this;

    // join channels
    _.each(this.core.options.channels, function(channel){
        this.legiond.join(channel);
    }, this);

    this.praetor.on("error", function(){});

    // handle promotion
    this.legiond.on("promoted", function(data){
        self.core.loggers["containership.core"].log("info", "Promoted to controlling leader!");
        self.legiond.leave("applications.sync");

        var hosts = self.core.hosts.get_all();
        self.core.loggers["containership.core"].log("verbose", ["Controlling cluster of", _.values(hosts).length, "nodes"].join(" "));
        _.each(self.core.hosts.get_all(), function(host, id){
            self.core.loggers["containership.core"].log("debug", ["Found", host.mode, "node:", id, "->", host.host_name].join(" "));
        });

        if(_.isEmpty(self.core.applications.list)){
            self.core.applications.bootstrap_from_disk(function(){
                self.core.applications.sync(function(){
                    setTimeout(function(){
                        self.core.scheduler.harmonize();
                    }, 15000);
                });
            });
        }
        else{
            self.core.applications.sync(function(){
                setTimeout(function(){
                    self.core.scheduler.harmonize();
                }, 15000);
            });
        }
    });

    // handle demotion
    this.legiond.on("demotion", function(data){
        self.core.loggers["containership.core"].log("info", "Demoted from controlling leader!");
        self.core.scheduler.deharmonize();
        self.legiond.join("applications.sync");
    });

    // handle new nodes
    this.legiond.on("node_added", function(node){
        if(self.praetor.is_controlling_leader()){
            self.core.loggers["containership.core"].log("info", ["Added node", node.host_name].join(" "));
            self.legiond.send("cluster.state", {
                id: self.core.cluster_id
            }, node);

            if(node.mode == "leader")
               self.core.applications.sync(function(){});
        }
    });

    // handle removed nodes
    this.legiond.on("node_removed", function(node){
        if(self.praetor.is_controlling_leader()){
            var containers = self.core.hosts.get_containers(node.id);

            self.core.loggers["containership.core"].log("info", ["Removed node", node.host_name].join(" "));

            _.each(containers, function(container){
                if(_.has(self.core.applications.list, container.application))
                    self.core.applications.list[container.application].unload_containers(container.id);
            });

            self.core.applications.sync(function(){});
        }
    });

    // handle cluster syncing applications
    this.legiond.on("applications.sync", function(apps){
        if(self.core.options.mode == "leader"){
            self.core.applications.deserialize(apps);
            self.core.applications.sync(function(){});
        }
    });

    // handle loading containers
    this.legiond.on("container.load", function(container_config){
        self.core.scheduler.follower.container.start(container_config);
    });

    // handle loaded containers
    this.legiond.on("container.loaded", function(container_config){
        self.core.applications.list[container_config.application_name].update_container(container_config.id, {
            status: "loaded"
        });
    });

    // handle unloading containers
    this.legiond.on("container.unload", function(container_config){
        self.core.scheduler.follower.container.stop(container_config);
    });

    // handle unloaded containers
    this.legiond.on("container.unloaded", function(container_config){
        var container = self.core.applications.list[container_config.application_name].containers[container_config.id];
        if(container.host == container_config.host){
            if(self.core.applications.list[container_config.application_name].respawn)
                self.core.applications.list[container_config.application_name].unload_containers(container_config.id);
            else
                self.core.applications.list[container_config.application_name].remove_container(container_config.id);
        }
    });

    // handle reconciled applications
    this.legiond.on("applications.reconciled", function(config){
        _.each(config, function(configuration, application){
            return self.core.applications.bootstrap_from_host(application, configuration);
        });
    });

    // handle reconciling running application containers
    this.legiond.on("applications.reconcile", function(leader){
        self.core.scheduler.follower.container.reconcile(leader);
    });

    // set the cluster state
    this.legiond.on("cluster.state", function(cluster){
        self.core.cluster_id = cluster.id;
    });

    // update host
    this.legiond.on("host.update", function(tags){
        self.core.loggers["containership.core"].log("info", "Updating host with new tags");
        self.legiond.set_attributes({
            tags: tags
        });
    });

    // delete host
    this.legiond.on("host.delete", function(){
        self.core.loggers["containership.core"].log("info", "Host shutdown requested. Shutting down ...");
        self.legiond.exit(function(){
            process.exit(0);
        });
    });

    // wait until legiond is listening
    this.legiond.on("listening", function(){
        return fn();
    });

}

module.exports = Cluster;
