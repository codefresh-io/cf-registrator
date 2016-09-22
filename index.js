'use strict';
var Q       = require('q');
var os = require('os');
var http = require('http');

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

        this.healthStatus = "passing";
    }

    register(service, heathCheck){

        var self = this;
        return self.consul.agent.self()
        .then(selfAgent => {
            self.serviceDef =
            {
                ID: service.ID || service.Name,
                Name: service.Name,
                Tags: service.Tags || [],
                Address: service.Address || selfAgent.Member.Addr,
                Port: service.Port || -1,
                EnableTagOverride: false
            };


            return self.consul.agent.service.register(self.serviceDef)
            .then(function(registerResult){
                var checkDef;
                if (heathCheck) {
                    self.checkDef = {
                        ID: heathCheck.ID || "check_" + self.serviceDef.ID,
                        ServiceID: self.serviceDef.ID,
                        Name: heathCheck.Name,
                        Notes: heathCheck.Notes || "Health check for service " + self.serviceDef.Name,
                        TTL: heathCheck.TTL || "15s"
                        //"Script": "/usr/local/bin/check_mem.py",
                        //"DockerContainerID": "f972c95ebf0e",
                        //"Shell": "/bin/bash",
                        //"HTTP": "http://example.com",
                        //"TCP": "example.com:22",
                        // Interval: "10s",
                    }
                    self.checkPromise = heathCheck.checkPromise || (() => Q({status: "passing"}));
                    return self.consul.agent.check.register(self.checkDef)
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

    deRegister(serviceId){
        return this.consul.agent.service.deregister( serviceId || this.serviceDef.ID);

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
                console.log(`HeartBit ${self.checkDef.ID} STATUS: ${res.statusCode}`);
                console.log(`HeartBit ${self.checkDef.ID} HEADERS: ${JSON.stringify(res.headers)}`);
            });
            hearBitReq.on('error', (e) => {
                console.log(`HeartBit ${self.checkDef.ID} error : ${e.message}`);
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

module.exports = Registrator;