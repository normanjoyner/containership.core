var _ = require("lodash");

function Hosts(core){
    this.core = core;
}

Hosts.prototype.get_all = function(){
    var hosts = this.core.cluster.legiond.get_peers();
    hosts.push(this.core.cluster.legiond.get_attributes());
    return _.indexBy(hosts, "id");
}

Hosts.prototype.get = function(id){
    return this.get_all()[id];
}

Hosts.prototype.get_containers = function(id){
    var containers = [];
    _.each(this.core.applications.serialize(), function(config, app_name){
        _.each(config.containers, function(config, container_id){
            if(config.host == id){
                delete config.host;
                containers.push(_.defaults(config, {
                    application: app_name
                }));
            }
        });
    });

    return containers;
}

Hosts.prototype.update = function(id, tags){
    var host = this.get(id);
    if(!_.isUndefined(host))
        this.core.cluster.legiond.send("host.update", tags, host);
}

Hosts.prototype.remove = function(id){
    var host = this.get(id);
    if(!_.isUndefined(host))
        this.core.cluster.legiond.send("host.delete", {}, host);
}

module.exports = Hosts;
