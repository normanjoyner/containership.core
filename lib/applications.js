var _ = require("lodash");
var async = require("async");
var cluster = require([__dirname, "cluster"].join("/"));
var crypto = require([__dirname, "crypto"].join("/"));
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
            self.core.cluster.myriad.persistence.get(self.core.constants.myriad.CLUSTER_ID, function(err, cluster_id){
                if(_.has(self.core.options, "cluster_id")){
                    self.core.cluster.myriad.persistence.set(self.core.constants.myriad.CLUSTER_ID, self.core.options.cluster_id, function(err){
                        self.core.cluster.set_id(function(){
                            self.core.cluster.legiond.send({
                                event: constants.events.CLUSTER_ID
                            });
                            return fn();
                        });
                    });
                }
                else if(err){
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

                        return fn();
                    });
                }
                else{
                    self.core.cluster.set_id(function(){
                        self.core.cluster.legiond.send({
                            event: constants.events.CLUSTER_ID
                        });
                        return fn();
                    });
                }
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
                respawn: true,
                volumes: [],
                privileged: false
            });

            self.core.scheduler.leader.application.get_loadbalancer_port(config.port, function(err, discovery_port){
                if(err)
                    return fn(err);
                else
                    config.discovery_port = discovery_port;

                var containers = config.containers || [];
                delete config.containers;

                self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, config.id].join("::"), JSON.stringify(config), function(err){
                    if(err)
                        return fn(err);

                    async.each(containers, function(container, fn){
                        if(_.has(container.tags, "constraints") && _.has(container.tags.constraints, "per_host") && _.has(container.tags, "host"))
                            delete container.tags.host;

                        if(container.random_host_port)
                            container.host_port = null;

                        container.status = "unloaded";
                        container.host = null;
                        container.start_time = null;

                        self.deploy_container(config.id, container, function(){
                            return fn();
                        });
                    }, fn);
                });
            });
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
                    self.remove_container(application_name, _.last(container_id.split(self.core.constants.myriad.DELIMITER)), fn);
                }, fn);
            });
        }
    ], fn);
}

Applications.prototype.get_containers = function(application_name, fn){
    var self = this;

    this.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, "*"].join("::"), function(err, containers){
        async.map(containers, function(container_id, fn){
            self.core.cluster.myriad.persistence.get(container_id, function(err, container){
                if(err)
                    return fn(err);

                try{
                    container = JSON.parse(container);
                    return fn(null, container);
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
            container = JSON.parse(container);
            return fn(null, container);
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
            configuration = _.omit(configuration, "id");
            var config = _.defaults(container, configuration);
            var tags = _.merge(container.tags, configuration.tags);
            config.tags = tags;
            self.core.scheduler.leader.container.deploy(application_name, config, fn);
        }
    ], function(err, resource){
        if(err)
            return fn(err);

        if(_.isUndefined(resource)){
            if(!_.has(container, "id"))
                container.id = crypto.generate_uuid(16);

            container.status = "unloaded";

            self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container.id].join("::"), JSON.stringify(container), function(err){
                return fn();
            });
        }

        if(!_.has(container, "id"))
            container.id = crypto.generate_uuid(16);

        if(resource.host_port == container.host_port)
            random_host_port = false;
        else
            random_host_port = true;

        container.host = resource.host.id;
        container.host_port = resource.host_port;
        container.random_host_port = random_host_port;
        container.status = "loading";
        container.start_time = new Date().valueOf();

        self.core.loggers["containership.core"].log("verbose", ["Deploying", application_name, "container", container.id, "to", resource.host.host_name].join(" "));

        async.series([
            function(fn){
                self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container.id].join("::"), JSON.stringify(container), fn);
            },
            function(fn){
                self.core.cluster.legiond.send({
                    event: constants.events.LOAD_CONTAINER,
                    data: {
                        application: application_name,
                        container: container
                    }
                }, resource.host);
                return fn();
            }
        ], fn);
    });
}

Applications.prototype.redeploy_containers = function(application_name, fn){
    var self = this;

    async.waterfall([
        function(fn){
            self.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, "*"].join("::"), fn);
        },
        function(containers, fn){
            async.each(containers, function(container_id, fn){
                async.series([
                    function(fn){
                        self.deploy_container(application_name, {}, fn);
                    },
                    function(fn){
                        self.remove_container(application_name, _.last(container_id.split("::")), fn);
                    }
                ], fn);
            }, fn);
        }
    ], fn);
}

Applications.prototype.remove_containers = function(application_name, num_containers, fn){
    var self = this;

    var errors = [];

    this.core.scheduler.leader.application.remove_containers(application_name, num_containers, function(err, container_ids){
        if(err)
            return fn(err);

        async.each(container_ids, function(container_id, fn){
            self.remove_container(application_name, container_id, function(err){
                if(err)
                    errors.push(container_id);

                return fn();
            });
        }, function(){
            if(!_.isEmpty(errors))
                return fn(new Error("Failed to remove containers:", errors.join(" ")));
            else
                return fn();
        });
    });
}

Applications.prototype.remove_container = function(application_name, container_id, fn){
    var self = this;

    this.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), function(err, container){
        if(err)
            return fn(err);

        try{
            container = JSON.parse(container);
        }
        catch(err){
            return fn(err);
        }

        if(container.status != "loaded"){
            self.core.cluster.myriad.persistence.delete([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), function(err){
                return fn(err);
            });
        }
        else{
            var hosts = _.indexBy(self.core.cluster.legiond.get_peers(), "id");
            var host = hosts[container.host];

            self.core.cluster.legiond.send({
                event: constants.events.UNLOAD_CONTAINER,
                data: {
                    application: application_name,
                    container_id: container_id,
                    engine: container.engine
                }
            }, host);

            return fn();
        }
    });
}

Applications.prototype.unload_containers = function(application_name, containers, fn){
    var self = this;

    this.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, "*"].join("::"), function(err, current_containers){
        if(_.isString(containers))
            containers = [containers];
        else if(_.isFunction(containers)){
            fn = containers;
            containers = _.map(current_containers, function(container){
                return _.last(container.split("::"));
            });
        }

        async.each(containers, function(container_id, fn){
            self.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), function(err, configuration){
                if(err)
                    return fn(err);

                try{
                    configuration = JSON.parse(configuration);
                }
                catch(err){
                    return fn(err);
                }

                if(configuration.random_host_port)
                    configuration.host_port = null;

                configuration.status = "unloaded";
                configuration.host = null;
                configuration.start_time = null;

                self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join("::"), JSON.stringify(configuration), fn);
            });
        }, fn);
    });
}

module.exports = Applications;
