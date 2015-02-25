var _ = require("lodash");
var async = require("async");
var crypto = require([__dirname, "crypto"].join("/"));
var Container = require([__dirname, "container"].join("/"));

// define Application
function Application(options, fn){
    _.defaults(this, {
        id: null,
        tags: {},
        env_vars: {},
        cpus: 0.1,
        memory: 128,
        command: "",
        image: "containership/engine",
        engine: "docker",
        network_mode: "bridge",
        containers: {}
    });

    this.update(options);
}

// update application
Application.prototype.update = function(options){
    if(_.has(options, "id"))
        this.id = options.id;
    if(_.has(options, "tags"))
        this.tags = options.tags;
    if(_.has(options, "env_vars"))
        this.env_vars = options.env_vars;
    if(_.has(options, "memory"))
        this.memory = options.memory;
    if(_.has(options, "cpus"))
        this.cpus = options.cpus;
    if(_.has(options, "command"))
        this.command = options.command;
    if(_.has(options, "image"))
        this.image = options.image;
    if(_.has(options, "container_port"))
        this.container_port = options.container_port;
    if(_.has(options, "discovery_port"))
        this.discovery_port = options.discovery_port;
    if(_.has(options, "engine"))
        this.engine = options.engine;
    if(_.has(options, "network_mode"))
        this.network_mode = options.network_mode;
    if(_.has(options, "containers"))
        this.deserialize_containers(options.containers);
}

// deserialize containers
Application.prototype.deserialize_containers = function(containers){
    _.each(containers, function(container){
        this.add_container(container);
    }, this);
}

// unload all containers
Application.prototype.unload_containers = function(containers){
    var self = this;

    if(_.isString(containers))
        containers = [containers];
    else if(_.isUndefined(containers))
        containers = _.keys(this.containers);

    _.each(containers, function(id){
        var config = {
            status: "unloaded",
            host: null,
            start_time: null
        }

        if(this.containers[id].random_host_port)
            config.host_port = null

        this.containers[id].update(config);
    }, this);
}

// add container to application
Application.prototype.add_container = function(options){
    if(_.has(options, "id") && _.has(this.containers, options.id)){
        this.containers[options.id].update(options);
        return this.containers[options.id].serialize();
    }
    else{
        while(_.isUndefined(options.id))
            options.id = crypto.generate_uuid(16);

        _.defaults(options, _.cloneDeep(this));
        delete options.discovery_port;

        var container = new Container(_.omit(options, ["container"]));
        this.containers[options.id] = container;
        return container.serialize();
    }
}

// update container
Application.prototype.update_container = function(id, config){
    this.containers[id].update(config);
}

// remove container from application
Application.prototype.remove_container = function(id){
    delete this.containers[id];
}

// remove all application containers
Application.prototype.remove_containers = function(){
    this.containers = {};
}

// serialize Application to json
Application.prototype.serialize = function(){
    return {
        id: this.id,
        tags: this.tags,
        env_vars: this.env_vars,
        memory: this.memory,
        cpus: this.cpus,
        command: this.command,
        image: this.image,
        engine: this.engine,
        discovery_port: this.discovery_port,
        container_port: this.container_port,
        network_mode: this.network_mode,
        containers: _.map(_.values(this.containers), function(container){
            return container.serialize();
        })
    }
}

module.exports = Application;
