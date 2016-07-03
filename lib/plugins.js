'use strict';

const fs = require('fs');
const _ = require('lodash');

class Plugins {
    constructor() {
        this.plugins = {};
    }

    initialize(core) {
        this.core = core;
    }

    load() {
        const self = this;

        try{
            let plugins = fs.readdirSync(self.core.options['plugin-location']);
            _.each(plugins, (plugin_name) => {
                try {
                    let plugin_path = `${self.core.options['plugin-location']}/${plugin_name}`;

                    _.each(_.keys(require.cache), (cache) => {
                        if(cache.indexOf(plugin_path) != -1)
                            delete require.cache[cache];
                    });

                    let plugin = require(plugin_path);

                    if((_.isString(plugin.type) && plugin.type == 'core') || (_.isArray(plugin.type) && _.contains(plugin.type, 'core'))) {
                        plugin.initialize(self.core);
                        self.core.loggers['containership.core'].log('verbose', `Loaded ${plugin_name} plugin`);
                        self.plugins[plugin_name] = plugin;
                    }
                } catch(e) {
                    self.core.loggers['containership.core'].log('warn', `Failed to load ${plugin_name} plugin`);
                    self.core.loggers['containership.core'].log('warn', e.message);
                }
            });

            self.core.loggers['containership.core'].log('info', `Successfully loaded ${_.keys(self.plugins).length} plugins!`);
        } catch(e) {
            self.core.loggers['containership.core'].log('warn', 'Invalid plugin path provided!');
            self.core.loggers['containership.core'].log('warn', e.message);
        }
    }

    reload () {
        let plugins = _.values(module.exports.plugins);
        _.each(plugins, (plugin) => { plugin.reload(); });
        module.exports.plugins = {};
        module.exports.load();
    }

}

module.exports = new Plugins();
