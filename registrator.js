'use strict';
var Q       = require('q');
var os = require('os');
var ip = require('ip');
var http = require('http');
var _ = require('lodash');
var CFError      = require('cf-errors');

var logger       = require('cf-logs').Logger("codefresh:cf-registrator");

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

    constructor() {

        this.setConsul();
        this.healthStatus = "passing";
        this.healthOutput = "";

        this.maxTries = 100;
        this.tryDelay = 10000;
    }

    setConsul(opts){
        opts = opts || {};
        if (! opts.host){
            opts.host = 'consul';
        }
        if (! opts.port){
            opts.port = 8500;
        }
        if (! opts.promisify){
            opts.promisify = fromCallback;
        }
        this.consulAddr = opts.host;
        this.consulPort = opts.port;
        this.consul = require('consul')(opts);
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
                self.serviceDef.Address = ip.address() || selfAgent.Config.AdvertiseAddr;
            }

            if (! self.serviceDef.ID ){
                self.serviceDef.ID = `${os.hostname()}:${self.serviceDef.Name}:${self.serviceDef.Port}`;
            }

            return self.consul.agent.service.register(self.serviceDef)
            .then(function(registerResult){ // jshint ignore:line
                if (heathCheck) {
                    return self.registerCheck(heathCheck)
                        .then((checkRegisterResult) => { // jshint ignore:line
                            if (self.checkDef.TTL) {
                                self.startHeartBeat();
                            }
                            self.registered = true;
                            logger.info(`Service ${self.serviceDef.Name} ${self.serviceDef.Address}:${self.serviceDef.Port} has been registered + health check`);
                            return Q.resolve(self.getRegistration());
                        });
                }
                else {
                    self.registered = true;
                    logger.info(`Service ${self.serviceDef.Name} ${self.serviceDef.Address}:${self.serviceDef.Port} has been registered without health check`);
                    return Q.resolve(self.getRegistration());
                }
            });
        })
        .catch(function(error) {
            if (! tryNum) tryNum = 0;
            let errorMsg = `ERROR: Service Register Failed ${JSON.stringify(self.serviceDef || service)} \ntryNum = ${tryNum}\n${error.toString()} `;
            logger.error(`${errorMsg} \n Retry after ${self.tryDelay} ms ...`);
            if (tryNum < self.maxTries)
                return Q.delay(self.tryDelay)
                .then(function() {
                    return self.register(service, heathCheck, tryNum + 1);
                });
            else
                return Q.reject(new CFError(`${errorMsg} \n max retries reached`));
        });
    }

    registerCheck(heathCheck){
        var self = this;
        self.checkDef = {
            ID: heathCheck.ID || ("check_" + self.serviceDef.ID),
            ServiceID: self.serviceDef.ID,
            Name: heathCheck.Name || ("check_" + self.serviceDef.Name) ,
            Notes: heathCheck.Notes || ("Health check for service " + self.serviceDef.Name),
            TTL: heathCheck.TTL || process.env.SERVICE_CHECK_TTL || "15s",
            Status: heathCheck.Status || "passing"
        };
        self.checkPromise = heathCheck.checkPromise || (() => Q({status: "passing"}));

        return self.consul.agent.check.register(self.checkDef)
            .then((checkRegisterResult) => { // jshint ignore:line
                return Q.resolve(self.checkDef);
            });

    }


    getRegistration(){
        var registration = {
            consulAddr: this.consulAddr,
            consulPort: this.consulPort,
            serviceDef: this.serviceDef,
            checkDef: this.checkDef
        };
        return registration;
    }

    deRegister(){
        var self = this;
        return Q().then(() => this.consul.agent.service.deregister(this.serviceDef.ID))
            .then(() => {
                self.registered = false;
                return Q(this.stopHeartBeat());
            });
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

            var heartBitReq = http.request(reqOptions, function (res) { // jshint ignore:line
               // logger.info(`HeartBit ${self.checkDef.ID} STATUS: ${res.statusCode}`);
               // logger.info(`HeartBit ${self.checkDef.ID} HEADERS: ${JSON.stringify(res.headers)}`);
            });
            heartBitReq.on('error', (e) => {
                logger.error(`HeartBit ${self.checkDef.ID} error : ${e.message}`);
            });
            heartBitReq.write(JSON.stringify(reqBody));
            heartBitReq.end();
        };

        this.heartBitIntervalId = setInterval(function() {
            self.checkPromise()
            .then(checkResult => {
                putHeartBitStatus(checkResult.status, checkResult.message);
            })
            .catch(err => {
                putHeartBitStatus("critical", err.toString());
            });

        }, self.checkDef.TTL.replace(/\D/,"") / 2 * 1000 );
        // return Q.resolve(this.heartBitIntervalId);
    }

    stopHeartBeat(){
        if (this.heartBitIntervalId) {
            clearInterval(this.heartBitIntervalId);
        }
        return true;
    }
}

module.exports = new Registrator();
