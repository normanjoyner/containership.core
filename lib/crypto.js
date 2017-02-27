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
    },

    encrypt: function(encryption_token, message) {
        let cipher = crypto.createCipher('aes-256-ctr', encryption_token);
        let encrypted = cipher.update(message, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    },

    decrypt: function(encryption_token, message) {
        let decipher = crypto.createDecipher('aes-256-ctr', encryption_token);
        let decrypted = decipher.update(message, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

};
