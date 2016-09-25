'use strict';
var Q       = require('q');
var os = require('os');
var ip = require('ip');
var http = require('http');
var _ = require('lodash');
var CFError      = require('cf-errors');

var logger = function(message){
    console.log(message);
}

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

    constructor(opts) {
        opts = opts || {};
        this.consulAddr = opts.consulAddr || 'consul';
        this.consulPort = opts.consulPort || 8500;
        this.consul = require('consul')({ host: this.consulAddr,
            port: this.consulPort,
            promisify: fromCallback });

        this.healthStatus = "passing";

        this.maxTries = opts.maxTries || 100;
        this.tryDelay = opts.tryDelay || 10000;
    }

    /**
     * sets this.serviceDef using service obj parameters and SERVICE_* env variables for default
     * SERVICE_* environments are similar with gliderlabs/registrator - http://gliderlabs.com/registrator/latest/user/services/
     * @param service
     */
    processServiceEnv(){
        var serviceDefaults = {
            ID: process.env.SERVICE_ID,
            Name: process.env.SERVICE_NAME,
            Address: process.env.SERVICE_ADDRESS,
            Port: process.env.SERVICE_PORT || -1,
            Tags: process.env.SERVICE_TAGS ? process.env.SERVICE_TAGS.split(',') : [],
            EnableTagOverride: process.env.SERVICE_EnableTagOverride? true: false
        };
        return serviceDefaults;
    }

    /**
     * Registers service with consul. Retries if failed
     * @param service
     * @param heathCheck
     * @returns {*}
     */
    register(service, heathCheck, tryNum){

        var self = this;
        return self.consul.agent.self()
        .then(selfAgent => {
            self.agent = selfAgent;

            self.serviceDef = _.merge(self.processServiceEnv(), service || {});
            if (! self.serviceDef.Name) {
                self.serviceDef.Name = 'Unnamed';
            }
            if (! self.serviceDef.Address) {
                self.serviceDef.Address = self.agent.Config.AdvertiseAddr || ip.address();
            }

            if (! self.serviceDef.ID ){
                self.serviceDef.ID = `${os.hostname()}:${self.serviceDef.Name}:${self.serviceDef.Port}`
            }

            return self.consul.agent.service.register(self.serviceDef)
            .then(function(registerResult){
                if (heathCheck) {
                    return self.registerCheck(heathCheck)
                        .then((checkRegisterResult) => {
                            if (self.checkDef.TTL) {
                                self.startHeartBeat();
                            }
                            return Q.resolve(self.getRegistration());
                        });
                }
                else {
                    return Q.resolve(self.getRegistration());
                }
            })
        })
        .catch(function(error) {
            if (! tryNum) tryNum = 0;
            let errorMsg = `ERROR: Service Register Failed ${self.serviceDef || service} \ntryNum = ${tryNum}\n${error.toString()} `
            logger(`${errorMsg} \n Retry after 2s ...`);
            if (tryNum < self.maxTries)
                return Q.delay(self.tryDelay).then(function() {
                    return self.register(service, heathCheck, tryNum + 1)
                });
            else
                return Q.reject(new CFError(`${errorMsg} \n max retries reached`));
        });
    }

    registerCheck(heathCheck, tryNum){
        var self = this;
        self.checkDef = {
            ID: heathCheck.ID || ("check_" + self.serviceDef.ID),
            ServiceID: self.serviceDef.ID,
            Name: heathCheck.Name,
            Notes: heathCheck.Notes || ("Health check for service " + self.serviceDef.Name),
            TTL: heathCheck.TTL || process.env.SERVICE_CHECK_TTL || "15s"
        }
        self.checkPromise = heathCheck.checkPromise || (() => Q({status: "passing"}));

        return self.consul.agent.check.register(self.checkDef)
            .then((checkRegisterResult) => {
                return Q.resolve(self.checkDef);
            });

    }


    getRegistration(){
        var registration = {
            consulAddr: this.consulAddr,
            consulPort: this.consulPort,
            serviceDef: this.serviceDef,
            checkDef: this.checkDef
        }
        return registration;
    }

    deRegister(){
        return this.consul.agent.service.deregister(this.serviceDef.ID);
    }

    setHealthStatus(status, message){
        this.healthStatus = status;
        this.healthOutput = message;
    }

    setHealthPassing(message){
        this.setHealthStatus("passing", message);
    }
    setHealthWarning(message){
        this.setHealthStatus("warning", message);
    }
    setHealthCritical(message){
        this.setHealthStatus("critical", message);
    }

    startHeartBeat(){
        var self = this;
        var reqOptions = {
            host: self.consulAddr,
            port: self.consulPort,
            path: "/v1/agent/check/update/" + self.checkDef.ID,
            method: "PUT",
            headers: {
                "Content-Type" : "application/json",
            }
        };


        var putHeartBitStatus = function(status, message){

            var reqBody = {
                Status: status || self.healthStatus,
                Output: message || self.healthOutput
            };

            var hearBitReq = http.request(reqOptions, function (res) {
               // logger(`HeartBit ${self.checkDef.ID} STATUS: ${res.statusCode}`);
               // logger(`HeartBit ${self.checkDef.ID} HEADERS: ${JSON.stringify(res.headers)}`);
            });
            hearBitReq.on('error', (e) => {
                logger(`HeartBit ${self.checkDef.ID} error : ${e.message}`);
            });
            hearBitReq.write(JSON.stringify(reqBody));
            hearBitReq.end();
        }

        setInterval(function() {
            self.checkPromise()
            .then(checkResult => {
                putHeartBitStatus(checkResult.status, checkResult.message);
            })
            .catch(err => {
                putHeartBitStatus("critical", err.toString());
            });

        }, self.checkDef.TTL.replace(/\D/,"") / 2 * 1000 );
    }
}

module.exports = new Registrator();
