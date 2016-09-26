# cf-registrator

### module for registration Codefresh services with Service Discovery (consul)

** Features **
- Registers services to consul agent/service/register endpoint - https://www.consul.io/docs/agent/http/agent.html#agent_check_register

- Deregisters service on SIGTERM

- Optionally registers healthcheck and starts status heartbit to consul TTL endpoint - https://www.consul.io/docs/agent/http/agent.html#agent_check_pass



#### Example

##### registrator.js
```js
'use strict';

var registrator = require('cf-registrator');
var config = require('./config/environment');
var Q = require('q');

var serviceDef = {
    Name: config.serviceName,
    Port: config.port
};

var checkDef = {
    checkPromise: function(){
        let status = "passing";
        let message = "cf-api works normally";
        return Q.resolve({status: status,
                          message: message});
    }
};

registrator.register(serviceDef, checkDef);

```

##### index.js
```js
require('./registrator');
```

##### sigterm.js
```js
process.on('SIGTERM', function () {
    // Graceful stop code
    console.log("Deregister service");
    registrator.deRegister();
});

```