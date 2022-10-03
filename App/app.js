const { Observable, from, of } = require('rxjs');var mqtt = require('./mqttCluster.js');
const {  map,shareReplay, filter,switchMap} = require('rxjs/operators');

global.mtqqLocalPath = process.env.MQTTLOCAL;
//global.mtqqLocalPath = 'mqtt://192.168.0.11';




const rawDoorSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x00158d0007ecd814', function(content){    
            subscriber.next(content)
    });
});

const masterSwitchSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x94deb8fffe57b8ff', function(content){    
            subscriber.next(content)
    });
});


const doorSensor = rawDoorSensor.pipe(map(m => !m.contact),shareReplay(1))




const masterSwitchStream = masterSwitchSensor.pipe(
    filter( c=> c.action==='on' || c.action==='brightness_stop')
    ,map(m => m.action==='on')
)


const operationStream = masterSwitchStream.pipe(
    switchMap( ms => {
        if (ms){
          return doorSensor
        }
        else{
            return of(ms)
        }
           
    })
)

operationStream
.subscribe(async m => {
    const state = m?"ON":"OFF";
    (await mqtt.getClusterAsync()).publishData('zigbee2mqtt/0x00124b0024c2eaf7/set',{state})
})




