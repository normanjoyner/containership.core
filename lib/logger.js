'use strict';

const winston = require('winston');
const mkdirp = require('mkdirp');

class Logger {
    constructor(core) {
        this.logger = null;
        this.core = core;

        try {
            mkdirp.sync(core.options['base-log-dir']);
        } catch(err) {
            process.stderr.write(`Error creating base log directory path: ${err.message}\n`);
            process.exit(1);
        }

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
            filename: `${this.core.options['base-log-dir']}/containership.log`
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
