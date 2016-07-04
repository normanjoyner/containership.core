'use strict';

const crypto = require('crypto');
const uuid = require('node-uuid');

module.exports = {

    generate_uuid: () => {
        return uuid.v4();
    },

    hash: (string, type) => {
        const hash = crypto.createHash(type);
        hash.update(string, 'utf8');
        return hash.digest('hex');
    }

};
