'use strict';
var chai       = require('chai');
var expect     = chai.expect;
var Q          = require('q');
var proxyquire = require('proxyquire');
var sinon      = require('sinon'); // jshint ignore:line
var sinonChai  = require('sinon-chai');

chai.use(sinonChai);

var http = require('http');

class RegistratorSpy {
    constructor(){
        this.consulAgentSelfStub = sinon.stub();
        this.consulAgentSelfStub.returns(Q.resolve({Config: {AdvertiseAddr: "2.2.2.2"}}));

        this.consulAgentServiceRegisterStub = sinon.stub().returns(Q.resolve('true'));
        this.consulAgentCheckRegisterStub = sinon.stub().returns(Q.resolve('true'));
        this.consulAgentServiceDeRegisterStub = sinon.stub().returns(Q.resolve('true'));

        this.httpRequest = sinon.stub();
    }
}

function registratorProxyquire(spyObj){
    if (! spyObj ) {
        spyObj = new RegistratorSpy();
    }
    var registrator = proxyquire(
        './index', {
            'http': function(){
                return {
                    request: sinon.stub()
                };
            }
        }
    );
    registrator.tryDelay = 0.01;
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
        var registrator = require('./registrator');
        expect(registrator.consul._opts.host).to.equal('consul');
        expect(registrator.consul._opts.port).to.equal(8500);
    });

    it('processServiceEnv', function() {

        process.env.SERVICE_ID = 'test:service:0001';
        process.env.SERVICE_NAME = 'test_service';
        process.env.SERVICE_ADDRESS = '1.1.1.1';
        process.env.SERVICE_TAGS = 'tag1,tag2';

        var registrator = require('./registrator');

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
        registrator.startHeartBeat = sinon.stub();

        return registrator.register(serviceDef, checkDef)
        .then( (registration) => {
            expect(rSpy.consulAgentServiceRegisterStub).to.have.been.calledTwice; // jshint ignore:line
            expect(rSpy.consulAgentCheckRegisterStub).to.have.been.called; // jshint ignore:line
            expect(registrator.startHeartBeat ).to.have.been.called; // jshint ignore:line

            expect(registrator.serviceDef.ID).to.exist;  // jshint ignore:line
            expect(registration.checkDef.ServiceID).to.equal(registrator.serviceDef.ID);

        });
    });

    it('startHeartBeat', function(){
        this.request = sinon.stub(http, 'request');
        var clock = sinon.useFakeTimers();
        var registrator = require('./registrator');
        registrator.healthStatus = "passing";
        registrator.healthOutput = "passing Test";
        registrator.checkDef.ID = 'check:test:ID1';
        registrator.checkDef.TTL = "10s";
        registrator.checkPromise = function(){
            return Q.resolve({
                status: registrator.healthStatus,
                message: registrator.healthOutput
            })
        }

        return Q.resolve(registrator.startHeartBeat())
            .then(() => {
                http.request.restore();
                this.clock.restore();
            });



    });
});
