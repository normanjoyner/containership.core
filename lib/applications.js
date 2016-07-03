'use strict';

const crypto = require('./crypto');
const constants = require('./constants');

const _ = require('lodash');
const async = require('async');

class Applications {
    constructor(core) {
        this.list = {};
        this.core = core;
    }

    // restores applications from myriad snapshot
    bootstrap(callback) {
        const self = this;

        async.series([
            // retrieve cluster_id from myriad or set if undefined
            (callback) => {
                self.core.cluster.myriad.persistence.get(self.core.constants.myriad.CLUSTER_ID, (err/*, cluster_id*/) => {
                    if(_.has(self.core.options, 'cluster_id')) {
                        self.core.cluster.myriad.persistence.set(self.core.constants.myriad.CLUSTER_ID, self.core.options.cluster_id, (/*err*/) => {
                            self.core.cluster.set_id(() => {
                                self.core.cluster.legiond.send({
                                    event: constants.events.CLUSTER_ID
                                });
                                return callback();
                            });
                        });
                    } else if(err) {
                        async.series([
                            (callback) => {
                                self.core.cluster.generate_id(callback);
                            },
                            (callback) => {
                                self.core.cluster.set_id(callback);
                            }
                        ], (err) => {
                            if(_.isNull(err)) {
                                self.core.cluster.legiond.send({
                                    event: constants.events.CLUSTER_ID
                                });
                            }
                            return callback();
                        });
                    } else {
                        self.core.cluster.set_id(() => {
                            self.core.cluster.legiond.send({
                                event: constants.events.CLUSTER_ID
                            });
                            return callback();
                        });
                    }
                });
            },

            // retrieve applications from myriad and deserialize
            (callback) => {
                self.core.cluster.myriad.persistence.keys(constants.myriad.APPLICATIONS, (err, applications) => {
                    if(_.isNull(err) && !_.isEmpty(applications)) {
                        self.core.loggers['containership.core'].log('info', 'Applications restored from disk snaphot');
                    }

                    async.series([
                        // unload all containers
                        (callback) => {
                            async.each(applications, (application_name, callback) => {
                                self.unload_containers(_.last(application_name.split(constants.myriad.DELIMITER)), callback);
                            }, callback);
                        },

                        // reconcile running containers
                        (callback) => {
                            self.core.cluster.legiond.send({
                                event: constants.events.RECONCILE
                            }, callback);
                        }
                    ], callback);
                });
            }
        ], callback);
    }

    add(config, callback) {
        const self = this;

        this.core.cluster.myriad.persistence.keys(constants.myriad.APPLICATIONS, (err, applications) => {
            if(!_.contains(applications, [constants.myriad.APPLICATION_PREFIX, config.id].join(constants.myriad.DELIMITER))) {
                _.defaults(config, {
                    id: null,
                    tags: {},
                    env_vars: {},
                    cpus: 0.1,
                    memory: 128,
                    command: '',
                    image: 'containership/engine',
                    engine: 'docker',
                    network_mode: 'bridge',
                    respawn: true,
                    volumes: [],
                    privileged: false
                });

                self.core.scheduler.leader.application.get_loadbalancer_port(config.port, (err, discovery_port) => {
                    if(err) {
                        return callback(err);
                    } else {
                        config.discovery_port = discovery_port;
                    }

                    let containers = config.containers || [];
                    delete config.containers;

                    self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, config.id].join(constants.myriad.DELIMITER), JSON.stringify(config), (err) => {
                        if(err) {
                            return callback(err);
                        }

                        async.each(containers, (container, callback) => {
                            if(_.has(container.tags, 'constraints') && _.has(container.tags.constraints, 'per_host') && _.has(container.tags, 'host')) {
                                delete container.tags.host;
                            }

                            if(container.random_host_port) {
                                container.host_port = null;
                            }

                            container.status = 'unloaded';
                            container.host = null;
                            container.start_time = null;

                            self.deploy_container(config.id, container, () => {
                                return callback();
                            });
                        }, callback);
                    });
                });
            } else {
                self.core.cluster.myriad.persistence.get([constants.myriad.APPLICATION_PREFIX, config.id].join(constants.myriad.DELIMITER), (err, application) => {
                    if(err) {
                        return callback(err);
                    }

                    try {
                        application = JSON.parse(application);
                    } catch(err) {
                        return callback(err);
                    }

                    _.defaults(config, application);

                    self.core.cluster.myriad.persistence.set([constants.myriad.APPLICATION_PREFIX, config.id].join(constants.myriad.DELIMITER), JSON.stringify(config), (err) => {
                        if(err) {
                            return callback(err);
                        }

                        const application_name = config.id;
                        delete config.id;

                        self.get_containers(application_name, (err, containers) => {
                            async.each(containers, (container, callback) => {
                                _.merge(container, config);
                                self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container.id].join(constants.myriad.DELIMITER), JSON.stringify(container), (/*err*/) => {
                                    return callback();
                                });
                            }, callback);
                        });
                    });
                });
            }
        });
    }

    remove(application_name, callback) {
        const self = this;

        async.series([
            (callback) => {
                self.core.cluster.myriad.persistence.delete([constants.myriad.APPLICATION_PREFIX, application_name].join(constants.myriad.DELIMITER), callback);
            },
            (callback) => {
                self.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, '*'].join(constants.myriad.DELIMITER), (err, containers) => {
                    async.each(containers, (container_id, callback) => {
                        self.remove_container(application_name, _.last(container_id.split(self.core.constants.myriad.DELIMITER)), callback);
                    }, callback);
                });
            }
        ], callback);
    }

    get_containers(application_name, callback) {
        const self = this;

        this.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, '*'].join(constants.myriad.DELIMITER), (err, containers) => {
            async.map(containers, (container_id, callback) => {
                self.core.cluster.myriad.persistence.get(container_id, (err, container) => {
                    if(err) {
                        return callback(err);
                    }

                    try {
                        container = JSON.parse(container);
                        return callback(null, container);
                    } catch(err) {
                        return callback(err);
                    }
                });
            }, callback);
        });
    }

    get_container(application_name, container_id, callback) {
        this.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join(constants.myriad.DELIMITER), (err, container) => {
            if(err) {
                return callback(err);
            }

            try {
                container = JSON.parse(container);
                return callback(null, container);
            } catch(err) {
                return callback(err);
            }
        });
    }

    deploy_container(application_name, container, callback) {
        const self = this;

        async.waterfall([
            (callback) => {
                self.core.cluster.myriad.persistence.get([constants.myriad.APPLICATION_PREFIX, application_name].join(constants.myriad.DELIMITER), (err, application) => {
                    if(err) {
                        return callback(err);
                    }

                    try {
                        return callback(null, JSON.parse(application));
                    } catch(err) {
                        return callback(err);
                    }
                });
            },
            (configuration, callback) => {
                configuration = _.omit(configuration, 'id');
                let config = _.defaults(container, configuration);
                const tags = _.merge(container.tags, configuration.tags);
                config.tags = tags;
                self.core.scheduler.leader.container.deploy(application_name, config, callback);
            }
        ], (err, resource) => {
            if(!_.has(container, 'id')) {
                container.id = crypto.generate_uuid();
            }

            if(err) {
                return callback(err);
            }

            if(_.isUndefined(resource)) {
                container.status = 'unloaded';

                self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container.id].join(constants.myriad.DELIMITER), JSON.stringify(container), (/*err*/) => {
                    return callback();
                });
            } else {
                let random_host_port = true;
                if(resource.host_port == container.host_port) {
                    random_host_port = false;
                }

                container.host = resource.host.id;
                container.host_port = resource.host_port;
                container.random_host_port = random_host_port;
                container.status = 'loading';
                container.start_time = new Date().valueOf();

                self.core.loggers['containership.core'].log('verbose', `Deploying ${application_name} container ${container.id} to ${resource.host.host_name}`);

                async.series([
                    (callback) => {
                        self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container.id].join(constants.myriad.DELIMITER), JSON.stringify(container), callback);
                    },
                    (callback) => {
                        self.core.cluster.legiond.send({
                            event: constants.events.LOAD_CONTAINER,
                            data: {
                                application: application_name,
                                container: container
                            }
                        }, resource.host);
                        return callback();
                    }
                ], callback);
            }
        });
    }

    redeploy_containers(application_name, callback) {
        const self = this;

        this.get_containers(application_name, (err, containers) => {
            if(err) {
                return callback(err);
            }

            async.each(containers, (container, callback) => {
                async.series([
                    (callback) => {
                        self.deploy_container(application_name, _.omit(container, ['id', 'host', 'start_time']), () => {
                            return callback();
                        });
                    },
                    (callback) => {
                        self.remove_container(application_name, container.id, () => {
                            return callback();
                        });
                    }
                ], callback);
            }, callback);
        });
    }

    remove_containers(application_name, num_containers, callback) {
        const self = this;

        const errors = [];

        this.core.scheduler.leader.application.remove_containers(application_name, num_containers, (err, container_ids) => {
            if(err) {
                return callback(err);
            }

            async.each(container_ids, (container_id, callback) => {
                self.remove_container(application_name, container_id, (err) => {
                    if(err) {
                        errors.push(container_id);
                    }

                    return callback();
                });
            }, () => {
                if(!_.isEmpty(errors)) {
                    return callback(new Error(`Failed to remove containers: ${errors.join(' ')}`));
                } else {
                    return callback();
                }
            });
        });
    }

    remove_container(application_name, container_id, callback) {
        const self = this;

        this.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join(constants.myriad.DELIMITER), (err, container) => {
            if(err) {
                return callback(err);
            }

            try {
                container = JSON.parse(container);
            } catch(err) {
                return callback(err);
            }

            if(container.status != 'loaded') {
                self.core.cluster.myriad.persistence.delete([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join(constants.myriad.DELIMITER), (err) => {
                    return callback(err);
                });
            } else {
                const hosts = _.indexBy(self.core.cluster.legiond.get_peers(), 'id');
                const host = hosts[container.host];

                self.core.cluster.legiond.send({
                    event: constants.events.UNLOAD_CONTAINER,
                    data: {
                        application: application_name,
                        container_id: container_id,
                        engine: container.engine
                    }
                }, host);

                return callback();
            }
        });
    }

    unload_containers(application_name, containers, callback) {
        const self = this;

        this.core.cluster.myriad.persistence.keys([constants.myriad.CONTAINERS_PREFIX, application_name, '*'].join(constants.myriad.DELIMITER), (err, current_containers) => {
            if(_.isString(containers)) {
                containers = [containers];
            } else if(_.isFunction(containers)) {
                callback = containers;
                containers = _.map(current_containers, (container) => {
                    return _.last(container.split(constants.myriad.DELIMITER));
                });
            }

            async.each(containers, (container_id, callback) => {
                self.core.cluster.myriad.persistence.get([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join(constants.myriad.DELIMITER), (err, configuration) => {
                    if(err) {
                        return callback(err);
                    }

                    try {
                        configuration = JSON.parse(configuration);
                    } catch(err) {
                        return callback(err);
                    }

                    if(configuration.random_host_port) {
                        configuration.host_port = null;
                    }

                    configuration.status = 'unloaded';
                    configuration.host = null;
                    configuration.start_time = null;

                    self.core.cluster.myriad.persistence.set([constants.myriad.CONTAINERS_PREFIX, application_name, container_id].join(constants.myriad.DELIMITER), JSON.stringify(configuration), callback);
                });
            }, callback);
        });
    }

}

module.exports = Applications;
