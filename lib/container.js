var _ = require("lodash");

// define Container
function Container(options, fn){
    this.update(options, fn);
}

// update container
Container.prototype.update = function(options){
    if(_.has(options, "id"))
        this.id = options.id;
    if(_.has(options, "start_time"))
        this.start_time = options.start_time;
    if(_.has(options, "host"))
        this.host = options.host;
    if(_.has(options, "tags"))
        this.tags = options.tags;
    if(_.has(options, "env_vars"))
        this.env_vars = options.env_vars;
    if(_.has(options, "cpus"))
        this.cpus = options.cpus;
    if(_.has(options, "memory"))
        this.memory = options.memory;
    if(_.has(options, "command"))
        this.command = options.command;
    if(_.has(options, "image"))
        this.image = options.image;
    if(_.has(options, "status"))
        this.status = options.status;
    if(_.has(options, "container_port"))
        this.container_port = options.container_port;
    if(_.has(options, "host_port"))
        this.host_port = options.host_port;
    if(_.has(options, "random_host_port"))
        this.random_host_port = options.random_host_port;
    if(_.has(options, "network_mode"))
        this.network_mode = options.network_mode;
    if(_.has(options, "engine"))
        this.engine = options.engine;
    if(_.has(options, "volumes"))
        this.volumes = options.volumes;
    if(_.has(options, "privileged"))
        this.privileged = options.privileged;
}

// serialize Container to json
Container.prototype.serialize = function(){
    return {
        id: this.id,
        start_time: this.start_time,
        host: this.host,
        tags: this.tags,
        env_vars: this.env_vars,
        cpus: this.cpus,
        memory: this.memory,
        command: this.command,
        image: this.image,
        status: this.status,
        container_port: this.container_port,
        random_host_port: this.random_host_port,
        host_port: this.host_port,
        network_mode: this.network_mode,
        engine: this.engine,
        volumes: this.volumes,
        privileged: this.privileged
    }
}

module.exports = Container;
