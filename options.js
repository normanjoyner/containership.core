'use strict';

const _ = require('lodash');
const os = require('os');

module.exports = {
    'connect-token': {
        help: 'Cluster auth token used to connect to other nodes',
        metavar: 'TOKEN',
    },

    cidr: {
        help: 'CIDR range to search for other Containership nodes',
        list: true,
        default: '127.0.0.1/32'
    },

    'legiond-scope': {
        help: 'Specifies whether nodes will communicate over their public or private ip address',
        choices: ['private', 'public'],
        default: 'public'
    },

    'legiond-interface': {
        help: 'Interface over which node will communicate',
        metavar: 'INTERFACE',
        choices: _.keys(os.networkInterfaces())
    },

    tag: {
        abbr: 't',
        list: true,
        help: 'Metadata tags for the instance',
        metavar: 'TAG',
        transform: (tags) => {
            const parts = tags.split('=');

            let tag = {
                tag: parts[0]
            };

            if(parts.length > 0)
                tag.value = _.rest(parts).join('=');
            else
                tag.value = undefined;

            return tag;
        }
    },

    'plugin-location': {
        help: 'Location to find plugins',
        metavar: 'PLUGIN_LOCATION',
        default: [process.env['HOME'], '.containership', 'plugins', 'node_modules'].join('/')
    },

    'base-log-dir': {
        help: 'Base log directory',
        metavar: 'LOG_LOCATION',
        default: '/var/log/containership'
    },

    'log-level': {
        abbr: 'l',
        help: 'Log level',
        metavar: 'LOG_LEVEL',
        choices: ['silly', 'debug', 'verbose', 'info', 'warn', 'error'],
        default: 'info'
    },

    'snapshot-location': {
        help: 'Location to write snapshots',
        metavar: 'SNAPSHOT_LOCATION',
        default: '/opt/containership/containership.snapshot'
    },

    mode: {
        help: 'Agent mode to run in',
        metavar: 'MODE',
        choices: ['leader', 'follower'],
        required: true
    },

    'node-id': {
        help: 'Unique node id for the node',
        metavar: 'NODE_ID'
    },

    'cluster-id': {
        help: 'Unique id of the cluster',
        metavar: 'CLUSTER_ID'
    }
};
