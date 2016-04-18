var crypto = require("crypto");
var uuid = require("node-uuid");

module.exports = {

    generate_uuid: function(){
        return uuid.v4();
    },

    hash: function(string, type){
        var hash = crypto.createHash(type);
        hash.update(string, "utf8");
        return hash.digest("hex");
    }

}
