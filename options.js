var _ = require("lodash");
var pkg = require([__dirname, "package"].join("/"));

module.exports = {
    cidr: {
        help: "CIDR range to search for other Containership nodes",
        list: true,
        default: "127.0.0.1/32"
    },

    "legiond-scope": {
        help: "Specifies whether nodes will communicate over their public or private ip address",
        choices: ["private", "public"],
        default: "private"
    },

    tag: {
        abbr: "t",
        list: true,
        help: "Metadata tags for the instance",
        metavar: "TAG",
        transform: function(tags){
            var parts = tags.split("=");

            var tag = {
                tag: parts[0]
            }

            if(parts.length > 0)
                tag.value = _.rest(parts).join("=");
            else
                tag.value = undefined

            return tag;
        }
    },

    "plugin-location": {
        help: "Location to find plugins",
        metavar: "PLUGIN_LOCATION",
        default: [process.env["HOME"], ".containership", "plugins", "node_modules"].join("/")
    },

    "log-location": {
        help: "Location to write logs",
        metavar: "LOG_LOCATION",
        default: "/var/log/containership.log"
    },

    "log-level": {
        abbr: "l",
        help: "Log level",
        metavar: "LOG_LEVEL",
        choices: ["silly", "debug", "verbose", "info", "warn", "error"],
        default: "info"
    },

    "snapshot-location": {
        help: "Location to write snapshots",
        metavar: "SNAPSHOT_LOCATION",
        default: "/tmp/containership.snapshot"
    },

    mode: {
        help: "Agent mode to run in",
        metavar: "MODE",
        choices: ["leader", "follower"],
        required: true
    }
}
