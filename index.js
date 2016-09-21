var Q       = require('q');
var os = require('os');

var util    = require('util');
var fromCallback = function (fn) {
    var deferred = Q.defer();
    fn(function (err, data) {
        if (err) {
            deferred.reject(err);
        }
        else {
            deferred.resolve(data);
        }
    });
    return deferred.promise;
};

class Registrator{

    constructor(consulAddr, consulPort) {

        this.consulAddr = consulAddr || 'consul';
        this.consulPort = consulPort || 8500;
        this.consul = require('consul')({ host: this.consulAddr,
            port: this.consulPort,
            promisify: fromCallback });
    }

    register(serviceName, serviceOptions, heathCheckOptions){

    }

    deRegister(){

    }

    startHeartBeat(healthCheckPromise){

    }

}

module.exports = new Registrator();