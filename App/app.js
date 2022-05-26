const { Observable } = require('rxjs');var mqtt = require('./mqttCluster.js');

global.mtqqLocalPath = process.env.MQTTLOCAL;
//global.mtqqLocalPath = 'mqtt://piscos.tk';




const rawDoorSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x00158d0007ecd814', function(content){    
            subscriber.next(content)
    });
});


rawDoorSensor
.subscribe(async m => {
    const state = m.contact?"OFF":"ON";
    (await mqtt.getClusterAsync()).publishData('zigbee2mqtt/0x00124b0024c2eaf7/set',{state})
})


