var _ = require("lodash");
var winston = require("winston");

function Logger(core){
    this.logger = null;
    this.core = core;
    this.initialize();
}

Logger.prototype.initialize = function(){
    this.logger = new(winston.Logger);

    this.logger.exitOnError = false;

    if(process.env.NODE_ENV == "development")
        var transport = winston.transports.Console;
    else
        var transport = winston.transports.File;

    this.logger.add(transport, {
        level: this.core.options["log-level"],
        filename: this.core.options["log-location"]
    });

    this.logger.handleExceptions();
}

Logger.prototype.register = function(source){
    var self = this;

    this.core.loggers[source] = {
        log: function(level, message){
            self.logger.log(level, message, {
                source: source
            });
        }
    }
}

module.exports = Logger;
