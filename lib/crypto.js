var crypto = require("crypto");

module.exports = {

    // gernerate random string
    generate_uuid: function(bytes){
        try{
            var uuid = crypto.randomBytes(bytes);
            return uuid.toString("hex");
        }
        catch(e){
            return;
        }
    },

    hash: function(string, type){
        var hash = crypto.createHash(type);
        hash.update(string, "utf8");
        return hash.digest("hex");
    }

}
