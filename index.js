'use strict';

var registrator = require('./registrator');

process.on('SIGTERM', function () {
    console.log("Deregister service");
    registrator.deRegister();
});

module.exports = registrator;