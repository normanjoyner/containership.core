var os = require("os");

module.exports = {

    get_memory: function(){
        return os.totalmem() * 0.75;
    },

    get_cpus: function(){
        return os.cpus().length;
    }

}
