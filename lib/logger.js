'use strict';

const winston = require('winston');

class Logger {
    constructor(core) {
        this.logger = null;
        this.core = core;
        this.initialize();
    }

    initialize() {
        this.logger = new(winston.Logger);
        this.logger.exitOnError = false;

        let transport = winston.transports.File;

        if('development' === process.env.NODE_ENV) {
            transport = winston.transports.Console;
        }

        this.logger.add(transport, {
            // handle exceptions when we are not in development
            handleExceptions: 'development' !== process.env.NODE_ENV,
            level: this.core.options['log-level'],
            filename: this.core.options['log-location']
        });
    }

    register(source) {
        const self = this;

        this.core.loggers[source] = {
            log: (level, message) => {
                self.logger.log(level, message, {
                    source: source
                });
            }
        };
    }
}

module.exports = Logger;
