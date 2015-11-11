var fs = require("fs");
var _ = require("lodash");

module.exports = {

    initialize: function(core){
        this.core = core;
    },

    plugins: {},

    load: function(){
        var self = this;

        try{
            var plugins = fs.readdirSync(self.core.options["plugin-location"]);
            _.each(plugins, function(plugin_name){
                try{
                    var plugin_path = [self.core.options["plugin-location"], plugin_name].join("/");

                    _.each(_.keys(require.cache), function(cache){
                        if(cache.indexOf(plugin_path) != -1)
                            delete require.cache[cache];
                    });

                    var plugin = require(plugin_path);

                    if((_.isString(plugin.type) && plugin.type == "core") || (_.isArray(plugin.type) && _.contains(plugin.type, "core"))){
                        plugin.initialize(self.core);
                        self.core.loggers["containership.core"].log("verbose", ["Loaded", plugin_name, "plugin"].join(" "));
                        self.plugins[plugin_name] = plugin;
                    }
                }
                catch(e){
                    self.core.loggers["containership.core"].log("warn", ["Failed to load", plugin_name, "plugin"].join(" "));
                    self.core.loggers["containership.core"].log("warn", e.message);
                }
            });

            self.core.loggers["containership.core"].log("info", ["Successfully loaded", _.keys(self.plugins).length, "plugins!"].join(" "));
        }
        catch(e){
            self.core.loggers["containership.core"].log("warn", "Invalid plugin path provided!");
            self.core.loggers["containership.core"].log("warn", e.message);
        }
    },

    reload: function(){
        var plugins = _.values(module.exports.plugins);
        _.each(plugins, function(plugin){
            plugin.reload();
        });
        module.exports.plugins = {};
        module.exports.load();
    }

}
