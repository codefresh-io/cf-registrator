'use strict';
var Registrator = require('.');
var Q       = require('q');



var service1 = {
    ID: "testService1-1",
    Name: "testService1"
};

var checkPromise = function(){
    return Q.resolve({status: "passing", message: "WARNING TEST"});
}

var check1 = {
    ID: "checkTestService1-1",
    Name: "testService1",
    TTL: "10s",
   // checkPromise: checkPromise
};

var service2 = {
    ID: "testService1-2",
    Name: "testService1"
};

var registrator1 = Registrator;
// var registrator2 = new Registrator();

Q.all([registrator1.register(service1, check1),
  //  registrator2.register(service2),
])
//Q.all([
//    registrator1.deRegister(service1.ID),
//    registrator2.deRegister(service2.ID),
//])

.then(function(registerResult){
   console.log("registerResult = " + registerResult);
})
.catch(function(error){
    console.log("register error = " + error);
});