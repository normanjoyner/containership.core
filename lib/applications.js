var _ = require("lodash");
var async = require("async");
var cluster = require([__dirname, "cluster"].join("/"));
var constants = require([__dirname, "constants"].join("/"));

function Applications(core){
    this.list = {};
    this.core = core;
}

// bootstrap applications from myriad snapshot
Applications.prototype.bootstrap = function(fn){
    var self = this;

    async.series([
        // retrieve cluster_id from myriad or set if undefined
        function(fn){
            self.core.cluster.myriad.persistence.get("containership.cluster_id", function(err, cluster_id){
                if(err){
                    async.series([
                        function(fn){
                            self.core.cluster.generate_id(fn);
                        },
                        function(fn){
                            self.core.cluster.set_id(fn);
                        }
                    ], function(err){
                        if(_.isNull(err)){
                            self.core.cluster.legiond.send({
                                event: constants.events.CLUSTER_ID
                            });
                        }
                    });
                }
                else
                    return fn();
            });
        },

        // retriveve applications from myriad and deserialize
        function(fn){
            self.core.cluster.myriad.persistence.keys(constants.myriad.APPLICATIONS, function(err, applications){
                if(_.isNull(err) && !_.isEmpty(applications))
                    self.core.loggers["containership.core"].log("info", "Applications restored from disk snaphot");

                async.series([
                    // unload all containers
                    function(fn){
                        async.each(applications, function(application_name, fn){
                            self.unload_containers(_.last(application_name.split("::")), fn);
                        }, fn);
                    },

                    // reconcile running containers
                    function(fn){
                        self.core.cluster.legiond.send({
                            event: constants.events.RECONCILE
                        });
                    }
                ], fn);
            });
        }
    ], fn);
}

Applications.prototype.add = function(config, fn){
    var self = this;

    this.core.cluster.myriad.persistence.keys(constants.myriad.APPLICATIONS, function(err, applications){
        if(!_.contains(applications, [constants.myriad.APPLICATION_PREFIX, config.id].join("::"))){
            _.defaults(config, {
                id: null,
                tags: {},
                env_vars: {},
                cpus: 0.1,
                memory: 128,
                command: "",
                image: "containership/engine",
                engine: "docker",
                network_mode: "bridge",
                containers: {},
                respawn: true,
                volumes: []
            });

            var discovery_port = self.core.scheduler.leader.application.get_loadbalancer_port(config.port);
            if(_.isUndefined(discovery_port))
                return fn();
            else
                config.discovery_port = discovery_port;

            self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, config.id].join("::"), JSON.stringify(config), fn);
        }
        else{
            self.core.cluster.myriad.persistence.get([constants.myriad.APPLICATION_PREFIX, config.id].join("::"), function(err, application){
                if(err)
                    return fn(err);

                try{
                    application = JSON.parse(application);
                }
                catch(err){
                    return fn(err);
                }

                _.defaults(config, application);

                self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, config.id].join("::"), JSON.stringify(config), fn);
            });
        }
    });
}

Applications.prototype.remove = function(application_name, fn){
    var self = this;

    async.series([
        function(fn){
            self.core.cluster.myriad.persistence.delete([constants.myriad.APPLICATION_PREFIX, application_name].join("::"), fn);
        },
        function(fn){
            self.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, "*"].join("::"), function(err, containers){
                async.each(containers, function(container_id, fn){
                    self.core.cluster.myriad.persistence.delete([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), fn);
                }, fn);
            });
        }
    ], fn);
}

Applications.prototype.get_containers = function(application_name, fn){
    var self = this;

    this.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, "*"].join("::"), function(err, containers){
        async.map(containers, function(container_id, fn){
            self.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), function(err, container){
                if(err)
                    return fn(err);

                try{
                    return fn(null, JSON.parse(container));
                }
                catch(err){
                    return fn(err);
                }
            });
        }, fn);
    });
}

Applications.prototype.get_container = function(application_name, container_id, fn){
    this.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), function(err, container){
        if(err)
            return fn(err);

        try{
            return fn(null, JSON.parse(container));
        }
        catch(err){
            return fn(err);
        }
    });
}

Applications.prototype.deploy_container = function(application_name, container, fn){
    var self = this;

    async.waterfall([
        function(fn){
            self.core.cluster.myriad.persistence.get([constants.myriad.APPLICATION_PREFIX, application_name].join("::"), function(err, application){
                if(err)
                    return fn(err);

                try{
                    return fn(null, JSON.parse(application));
                }
                catch(err){
                    return fn(err);
                }
            });
        },
        function(configuration, fn){
            self.core.scheduler.leader.container.deploy(application_name, container, function(host, host_port){
                return fn(null, {
                    host: host,
                    host_port: host_port
                });
            });
        }
    ], function(err, resource){
        if(!_.isNull(err))
            return fn(err);

        if(!_.isUndefined(resource.host)){
            if(!_.has(container, "id"))
                container.id = crypto.generate_uuid(16);

            if(resource.host_port == container.host_port)
                random_host_port = false;
            else
                random_host_port = true;

            container.host = resource.host_id;
            container.host_port = resource.host_port;
            container.random_host_port = random_host_port;
            container.status = "loading";
            container.start_time = new Date().valueOf();

            // clear existing ContainerShip environment variables
            _.each(container.env_vars, function(value, name){
                if(name.indexOf("CS_") == 0)
                    delete container.env_vars[name];
            });

            // set standard environment variables
            _.defaults(container.env_vars, {
                CS_CONTAINER_ID: container.id,
                CS_APPLICATION: application_name,
                CS_CLUSTER_ID: self.core.cluster_id
            });

            // set discovery environment variables
            // TODO move this logic to scheduler now that we have myriad
            self.core.cluster.myriad.persistence.keys(constants.myriad.APPLICATIONS, function(err, applications){
                async.each(applications, function(application_name, fn){
                    self.core.cluster.myriad.persistence.get(application_name, function(err, configuration){
                        if(err)
                            return fn();

                        try{
                            configuration = JSON.parse(configuration);
                        }
                        catch(err){
                            return fn();
                        }

                        application_name = _.last(application_name.split("."));

                        var name = ["CS", "DISCOVERY", "PORT", application_name.toUpperCase()].join("_");
                        container.env_vars[name] = configuration.discovery_port;

                        var name = ["CS", "ADDRESS", application_name.toUpperCase()].join("_");
                        new_container.env_vars[name] = [application_name, self.core.cluster_id, "containership"].join(".");

                        return fn();
                    });
                }, function(err){
                    self.core.loggers["containership.core"].log("verbose", ["Deploying", application_name, "container", container.id, "to", host.host_name].join(" "));

                    async.series([
                        function(fn){
                            self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINER_PREFIX, application_name, container.id].join("::"), JSON.stringify(container), fn);
                        },
                        function(fn){
                            self.core.cluster.legiond.send({
                                event: constants.events.LOAD_CONTAINER,
                                data: container.id
                            }, host);
                        }
                    ], fn);
                });
            });
        }
        else if(!_.has(container, "id")){
            if(resource.host_port == container.host_port)
                random_host_port = false;
            else
                random_host_port = true;

            container.id = crypto.generate_uuid(16);
            container.status = "unloaded";
            container.random_host_port = random_host_port;

            if(!random_host_port)
                container.host_port = host_port;

            self.core.loggers["containership.core"].log("verbose", ["No host available to deploy", application_name, "container", new_container.id].join(" "));
            return fn();
        }
        else
            return fn(new Error(["Failed to launch container for", application_name].join(" ")));
    });
}

Applications.prototype.redeploy_containers = function(application_name, fn){
    var self = this;

    async.waterfall([
        function(fn){
            self.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINER_PREFIX, application_name, "*"].join("::"), fn);
        },
        function(containers, fn){
            async.each(containers, function(container_id, fn){
                self.core.cluster.myriad.persistence.get([constants.myriad.CONTAINER_PREFIX, application_name, container_id].join("::"), function(err, container){
                    if(err)
                        return fn();

                    try{
                        container = JSON.parse(container);
                    }
                    catch(err){
                        return fn();
                    }

                    async.series([
                        function(fn){
                            delete container.status;
                            delete container.start_time;
                            delete container.id;

                            self.deploy_container(application_name, container, fn);
                        },
                        function(fn){
                            self.remove_container(application_name, container_id, fn);
                        }
                    ], fn);
                });
            }, fn);
        }
    ], fn);
}

Applications.prototype.remove_container = function(application_name, container_id, fn){
    self.core.cluster.myriad.persistence.get([constants.myriad.CONTAINER_PREFIX, application_name, container_id].join("::"), function(err, container){
        if(err)
            return fn(err);

        try{
            container = JSON.parse(container);
        }
        catch(err){
            return fn(err);
        }

        var hosts = _.indexBy(this.core.cluster.legiond.get_peers(), "id");
        var host = hosts[container.host];

        this.core.cluster.legiond.send({
            event: constants.events.UNLOAD_CONTAINER,
            data: container_id
        }, host);

        return fn();
    });
}

Applications.prototype.unload_containers = function(application_name, containers, fn){
    self.core.cluster.myriad.persistence.get([constants.myriad.APPLICATION_PREFIX, application_name].join("::"), function(err, configuration){
        if(err)
            return fn(err);

        try{
            configuration = JSON.parse(configuration);
        }
        catch(err){
            return fn(err);
        }

        if(_.isString(containers))
            containers = [containers];
        else if(_.isFunction(containers)){
            fn = containers;
            containers = _.keys(configuration.containers);
        }

        _.each(containers, function(id){
            if(configuration.containers[id].random_host_port)
                config.host_port = null

            configuration.containers[id].status = "unloaded";
            configuration.containers[id].host = null;
            configuration.containers[id].start_time = null;
        });

        self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, application_name].join("::"), JSON.stringify(configuration), function(err){
            return fn(err);
        });
    });
}

module.exports = Applications;
