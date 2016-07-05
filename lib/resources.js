'use strict';

const os = require('os');

module.exports = {

    get_memory: () => {
        return Math.floor(os.totalmem() * 0.95);
    },

    get_cpus: () => {
        return os.cpus().length;
    }

};
