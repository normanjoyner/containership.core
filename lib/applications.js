var _ = require("lodash");
var async = require("async");
var cluster = require([__dirname, "cluster"].join("/"));
var Application = require([__dirname, "application"].join("/"));
var hosts = require([__dirname, "hosts"].join("/"));
var persistence = require([__dirname, "persistence"].join("/"));
var crypto = require([__dirname, "crypto"].join("/"));

function Applications(core){
    this.list = {};
    this.core = core;
}

Applications.prototype.bootstrap_from_disk = function(fn){
    var self = this;
    var applications = {};

    this.core.persistence.bootstrap_snapshot(function(snapshot){
        if(_.has(snapshot, "cluster_id") && !_.isEmpty(snapshot.cluster_id))
            self.core.cluster_id = snapshot.cluster_id;
        else
            self.core.cluster_id = crypto.generate_uuid(16);

        // check if snapshot contains applications
        if(!_.isEmpty(snapshot.applications)){
            self.core.loggers["containership.core"].log("info", "Applications restored from disk snaphot");
            applications = snapshot.applications;

            // deserialize applications
            self.deserialize(applications);

            // unload all containers
            _.each(applications, function(application, name){
                self.list[application.id].unload_containers();
            });

            // craft reconciliation request
            var send_reconcile = function(host){
                return function(next){
                    if(host.id != self.core.cluster.legiond.get_attributes().id){
                        self.core.cluster.legiond.send("applications.reconcile", self.core.cluster.legiond.get_attributes(), host);
                        self.core.cluster.legiond.send("cluster.state", {
                            id: self.core.cluster_id
                        }, host);
                    }

                    return next();
                }
            }

            // send reconciliation requests in parallel
            async.parallel(_.map(self.core.hosts.get_all(), function(host){
                return send_reconcile(host);
            }), function(){
                return fn();
            });
        }
        else
            return fn();
    });
}

Applications.prototype.bootstrap_from_host = function(application, containers){
    var running_containers = _.indexBy(_.flatten(containers), "id");
    var stashed_containers = _.indexBy(this.list[application].serialize().containers, "id");

    // return if there are no running containers
    if(_.isEmpty(running_containers))
        return;

    // set host / status if container is running
    _.each(_.keys(running_containers), function(container_id){
        if(_.has(stashed_containers, container_id) && stashed_containers[container_id].status == "unloaded"){
            var container = stashed_containers[container_id];
            container.host = running_containers[container_id].host;
            container.host_port = running_containers[container_id].host_port;
            container.container_port = running_containers[container_id].container_port;
            container.start_time = running_containers[container_id].start_time;
            container.status = "loaded";
            this.list[application].deserialize_containers([container]);
        }
        else{
            var container = running_containers[container_id];
            this.core.cluster.legiond.send("container.unload", container, this.core.hosts.get(container.host));
        }
    }, this);
}

Applications.prototype.snapshot = function(fn){
    this.core.persistence.snapshot_applications(this.serialize(), fn);
}

Applications.prototype.get = function(application_name){
    return this.list[application_name].serialize();
}

Applications.prototype.add = function(config){
    if(!_.has(this.list, config.id)){
        var discovery_port = this.core.scheduler.leader.application.get_loadbalancer_port(config.port);
        if(!_.isUndefined(discovery_port)){
            config.discovery_port = discovery_port;
            this.list[config.id] = new Application(config);
            return this.list[config.id];
        }
        else
            return;
    }
    else{
        this.list[config.id].update(config);
        return this.list[config.id];
    }
}

Applications.prototype.remove = function(application_name){
    var self = this;
    var containers = this.get_containers(application_name);

    _.each(containers, function(container){
        self.remove_container(application_name, container.id);
    });

    delete self.list[application_name];
}

Applications.prototype.get_containers = function(application_name){
    var application = this.list[application_name].serialize();
    return application.containers;
}

Applications.prototype.deploy_container = function(application_name, container, fn){
    var self = this;

    this.core.scheduler.leader.container.deploy(application_name, container, function(host, host_port){
        if(_.has(container, "id") && !_.isUndefined(host) || !_.isUndefined(host)){
            if(host_port == container.host_port)
                random_host_port = false;
            else
                random_host_port = true;

            var container_config = _.defaults({
                start_time: new Date().valueOf(),
                host: host.id,
                status: "loading",
                host_port: host_port,
                random_host_port: random_host_port
            }, container);

            var new_container = self.list[application_name].add_container(container_config);
            new_container.application_name = application_name;

            // clear existing ContainerShip environment variables
            _.each(new_container.env_vars, function(value, name){
                if(name.indexOf("CS_") == 0)
                    delete new_container.env_vars[name];
            });

            // set standard environment variables
            _.defaults(new_container.env_vars, {
                CS_CONTAINER_ID: new_container.id,
                CS_APPLICATION: application_name,
                CS_CLUSTER_ID: self.core.cluster_id
            });

            // set discovery environment variables
            _.each(self.list, function(application, application_name){
                var name = ["CS", "DISCOVERY", "PORT", application_name.toUpperCase()].join("_");
                new_container.env_vars[name] = application.discovery_port;

                var name = ["CS", "ADDRESS", application_name.toUpperCase()].join("_");
                new_container.env_vars[name] = [application_name, self.core.cluster_id, "containership"].join(".");
            });

            self.core.cluster.legiond.send("container.load", new_container, host);
            self.core.loggers["containership.core"].log("verbose", ["Attempting to deploy", application_name, "container", new_container.id, "to", host.host_name].join(" "));
            return fn();
        }
        else if(!_.has(container, "id")){
            if(host_port == container.host_port)
                random_host_port = false;
            else
                random_host_port = true;

            var container_config = _.defaults({
                status: "unloaded",
                random_host_port: random_host_port
            }, container);

            if(!random_host_port)
                container_config.host_port = host_port;

            var new_container = self.list[application_name].add_container(container_config);
            self.core.loggers["containership.core"].log("verbose", ["No host available to deploy", application_name, "container", new_container.id].join(" "));
            return fn();
        }
        else
            return fn(new Error(["Failed to launch container for", application_name].join(" ")));
    });
}

Applications.prototype.redeploy_containers = function(application_name, fn){
    var self = this;
    var containers = this.get_containers(application_name);

    async.each(containers, function(container, next){
        self.deploy_container(application_name, {host: container.host}, function(err){
            if(_.isUndefined(err))
                self.remove_container(application_name, container.id);

            return self.sync(next);
        });
    }, fn);
}

Applications.prototype.remove_container = function(application_name, container_id){
    var container = this.core.scheduler.leader.container.remove(application_name, container_id);

    if(_.isUndefined(container))
        return;
    else{
        var host = this.core.hosts.get(container.host);
        this.list[application_name].remove_container(container.id);
        this.core.cluster.legiond.send("container.unload", container, host);
        return container.id;
    }
}

Applications.prototype.sync = function(fn){
    this.core.loggers["containership.core"].log("info", "Requesting application sync");
    this.core.cluster.legiond.send("applications.sync", this.serialize());
    return this.snapshot(fn);
}

Applications.prototype.serialize = function(){
    var applications = {};
    _.each(this.list, function(config, application_name){
        applications[application_name] = config.serialize();
    });
    return applications;
}

Applications.prototype.deserialize = function(applications){
    _.each(applications, function(application, name){
        this.add(application);
    }, this);
}

module.exports = Applications;
