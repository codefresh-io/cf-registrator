'use strict';
var chai       = require('chai');
var expect     = chai.expect;
var Q          = require('q');
var proxyquire = require('proxyquire');
var sinon      = require('sinon'); // jshint ignore:line
var sinonChai  = require('sinon-chai');

chai.use(sinonChai);

describe('cf-registrator tests', function () {
    var registrator = require('.');
    var sandbox;
    beforeEach(() => { sandbox = sinon.sandbox.create(); });
    afterEach(() => { sandbox.restore(); });

    it('object created', function () {

        expect(registrator.consul._opts.host).to.equal('consul');
        expect(registrator.consul._opts.port).to.equal(8500);
    });

    it('processServiceEnv', function () {
        let processEnv = {
            SERVICE_ID: 'test:service:0001',
            SERVICE_NAME: 'test_service',
            SERVICE_ADDRESS: '1.1.1.1',
            SERVICE_TAGS: 'tag1,tag2'
        }
        sandbox.stub(process, 'env', processEnv);

        //} 'SERVICE_ID', 'test:service:0001');
        //sandbox.stub(process.env, 'SERVICE_NAME', 'test_service');
        //sandbox.stub(process.env, 'SERVICE_ADDRESS', '1.1.1.1');
        //sandbox.stub(process.env, 'SERVICE_TAGS', 'tag1,tag2');

        let serviceDefaults = registrator.processServiceEnv();
        expect(serviceDefaults).to.include.keys('ID', 'Name', 'Address', 'Port', 'Tags', 'EnableTagOverride' );

        expect(serviceDefaults.Address).to.equal('1.1.1.1');
        expect(serviceDefaults.Port).to.equal(-1);
        expect(serviceDefaults.Tags).to.deep.equal(['tag1', 'tag2']);
    });

});
