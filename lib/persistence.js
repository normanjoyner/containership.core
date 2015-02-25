var fs = require("fs");

function Persistence(core){
    this.core = core;
}

Persistence.prototype.snapshot_applications = function(applications, fn){
    var self = this;
    this.bootstrap_snapshot(function(config){
        config.applications = applications;
        config.cluster_id = self.core.cluster_id;
        config = JSON.stringify(config);
        fs.writeFile(self.core.options["snapshot-location"], config, function(err){
            if(err)
                self.core.loggers["containership.core"].log("error", "Snapshotting applications failed");
            else
                self.core.loggers["containership.core"].log("info", "Snapshotting applications succeeded");

            return fn();
        });
    });
}

Persistence.prototype.bootstrap_snapshot = function(fn){
    fs.readFile(this.core.options["snapshot-location"], function(err, snapshot){
        try{
            return fn(JSON.parse(snapshot));
        }
        catch(e){
            return fn({
                applications: {}
            });
        }
    });
}

module.exports = Persistence;
