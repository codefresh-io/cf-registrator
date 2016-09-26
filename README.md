# cf-registrator

### module for registration Codefresh services with Service Discovery (consul)



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
        return Q.resolve({status: status, message: message});
    }
};

registrator.register(serviceDef, checkDef);

```

##### index.js
```js
require('./registrator');
```