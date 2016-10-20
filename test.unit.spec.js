'use strict';
var chai       = require('chai');
var expect     = chai.expect;
var Q          = require('q');
var proxyquire = require('proxyquire').preserveCache();
var sinon      = require('sinon'); // jshint ignore:line
var sinonChai  = require('sinon-chai');

chai.use(sinonChai);


class RegistratorSpy {
    constructor(){
        this.consulAgentSelfStub = sinon.stub();
        this.consulAgentSelfStub.returns(Q.resolve({Config: {AdvertiseAddr: "2.2.2.2"}}));

        this.consulAgentServiceRegisterStub = sinon.stub().returns(Q.resolve('true'));
        this.consulAgentCheckRegisterStub = sinon.stub().returns(Q.resolve('true'));
        this.consulAgentServiceDeRegisterStub = sinon.stub().returns(Q.resolve('true'));

        this.httpRequestStub = sinon.stub();
    }
}

function registratorProxyquire(spyObj){
    if (! spyObj ) {
        spyObj = new RegistratorSpy();
    }
    var registrator = proxyquire(
        './registrator', {
            'http':  {
                    request: spyObj.httpRequestStub
                },
                //'consul': {
                //    agent: {
                //        self: spyObj.consulAgentSelfStub,
                //            service: {
                //            register: spyObj.consulAgentServiceRegisterStub,
                //                deregister: spyObj.consulAgentServiceDeRegisterStub
                //        },
                //        check: {
                //            register: spyObj.consulAgentCheckRegisterStub
                //        }
                //    }
                //}
            }
    );

    registrator.consul = {
            agent: {
                self: spyObj.consulAgentSelfStub,
                service: {
                    register: spyObj.consulAgentServiceRegisterStub,
                    deregister: spyObj.consulAgentServiceDeRegisterStub
                },
                check: {
                    register: spyObj.consulAgentCheckRegisterStub
                }
            }
    };
    //if (! registrator.startHeartBeatStub) {
    //    registrator.startHeartBeatStub = sinon.stub(registrator, 'startHeartBeat');
    //}
    return registrator;
}

describe('cf-registrator tests', function () {
    //var sandbox;
    //beforeEach(() => {
    //    sandbox = sinon.sandbox.create({useFakeTimers: false});
    //});
    //afterEach(() => {
    //    sandbox.restore();
    //});

    it('object created', function () {
        var registrator = require('.');
        expect(registrator.consul._opts.host).to.equal('consul');
        expect(registrator.consul._opts.port).to.equal(8500);
    });

    it('set consul', function () {
        var registrator = require('.');
        registrator.setConsul({host: 'myConsul', port: 1234});
        expect(registrator.consul._opts.host).to.equal('myConsul');
        expect(registrator.consul._opts.port).to.equal(1234);
    });

    it('processServiceEnv', function() {

        process.env.SERVICE_ID = 'test:service:0001';
        process.env.SERVICE_NAME = 'test_service';
        process.env.SERVICE_ADDRESS = '1.1.1.1';
        process.env.SERVICE_TAGS = 'tag1,tag2';

        var registrator = require('.');

        let serviceDefaults = registrator.processServiceEnv();
        expect(serviceDefaults).to.include.keys('ID', 'Name', 'Address', 'Port', 'Tags', 'EnableTagOverride' );

        expect(serviceDefaults.Address).to.equal('1.1.1.1');
        expect(serviceDefaults.Port).to.equal(-1);
        expect(serviceDefaults.Tags).to.deep.equal(['tag1', 'tag2']);
    });

    it('register', function(){

        process.env.SERVICE_ADDRESS = '1.1.1.1';
        process.env.SERVICE_TAGS = 'tag1,tag2';

        let serviceDef = {
            Name: "testService1",
            Port: 9999
        };

        let checkDef = {
            checkPromise: function(){
                let status = "passing";
                let message = "service works normally";
                return Q.resolve({status: status,
                                 message: message});
            }
        };

        let rSpy = new RegistratorSpy();
        // Simulate Error on First registration - we will test retry
        rSpy.consulAgentServiceRegisterStub = sinon.stub();
        rSpy.consulAgentServiceRegisterStub.onFirstCall().returns(Q.reject(new Error("First registation Error")));
        rSpy.consulAgentServiceRegisterStub.onSecondCall().returns(Q.resolve("Second Registration Success"));

        let registrator = registratorProxyquire(rSpy);

        registrator.startHeartBeatStub = sinon.stub(registrator, 'startHeartBeat');
        registrator.tryDelay = 0.01;

        return registrator.register(serviceDef, checkDef)
        .then( (registration) => {
            expect(rSpy.consulAgentServiceRegisterStub).to.have.been.calledTwice; // jshint ignore:line
            expect(rSpy.consulAgentCheckRegisterStub).to.have.been.called; // jshint ignore:line
            expect(registrator.startHeartBeatStub).to.have.been.calledOnce; // jshint ignore:line

            expect(registrator.serviceDef.ID).to.exist;  // jshint ignore:line
            expect(registrator.registered).to.equal(true);
            expect(registration.checkDef.ServiceID).to.equal(registrator.serviceDef.ID );

        });
    });

    it('deRegister', function(){
        let rSpy = new RegistratorSpy();
        let registrator = registratorProxyquire(rSpy);
        registrator.serviceDef = {ID: 'test:service:id'};
        let stopHeartBeatSpy = sinon.spy(registrator, 'stopHeartBeat');

        return registrator.deRegister()
        .then(() => {
            expect(rSpy.consulAgentServiceDeRegisterStub).to.have.been.called; // jshint ignore:line
            expect(stopHeartBeatSpy).to.have.been.called; // jshint ignore:line
            expect(registrator.registered).to.equal(false);
        });
    });

    it('startHeartBeat', function(done){
        //this.request = sinon.stub(http, 'request');
        //var self = this;

        let rSpy = new RegistratorSpy();

        rSpy.httpRequestStub = sinon.stub();
        var request = new (require('stream').PassThrough); // jshint ignore:line
        var writeStub = sinon.spy(request, 'write'); // jshint ignore:line
        rSpy.httpRequestStub.returns(request);

        let registrator = registratorProxyquire(rSpy);

        registrator.healthStatus = "passing";
        registrator.healthOutput = "passing Test";
        registrator.checkDef = {
            ID: 'check:test:ID1',
            TTL: "10s"
        };
        registrator.checkPromise = sinon.spy(function() {
            return Q.resolve({
                status: registrator.healthStatus,
                message: registrator.healthOutput
            });
        });
        var clock = sinon.useFakeTimers();
        return Q()
        .then(() => {
            return Q.resolve(registrator.startHeartBeat());
        })
        .then(() => {
            expect(registrator.heartBitIntervalId).to.exist; // jshint ignore:line
            let t = clock.tick(12000);
            return Q.resolve(t);
        })
        .then(() => {
            expect(registrator.checkPromise).to.have.been.calledTwice; // jshint ignore:line
            expect(rSpy.httpRequestStub).to.have.been.calledTwice; // jshint ignore:line
            expect(writeStub).to.have.been.calledTwice; // jshint ignore:line
            done();
        })
        .finally(() => {
           clock.restore();

        });
    });
});
