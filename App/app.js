const { Observable,merge,timer, interval } = require('rxjs');
const { mergeMap, withLatestFrom, map,share,shareReplay, filter,mapTo,take,debounceTime,throttle,throttleTime, startWith, takeWhile, delay, scan, distinct,distinctUntilChanged, tap, flatMap, takeUntil, toArray, groupBy} = require('rxjs/operators');
var mqtt = require('./mqttCluster.js');
const CronJob = require('cron').CronJob;


global.mtqqLocalPath = process.env.MQTTLOCAL;
//global.mtqqLocalPath = 'mqtt://piscos.tk';


const GROUND_FLOOR_SENSOR_TOPIC = process.env.GROUND_FLOOR_SENSOR_TOPIC
const FIRST_FLOOR_SENSOR_TOPIC = process.env.FIRST_FLOOR_SENSOR_TOPIC
const SECOND_FLOOR_SENSOR_TOPIC = process.env.SECOND_FLOOR_SENSOR_TOPIC

const KEEPLIGHTONFORSECS = parseInt(process.env.KEEPLIGHTONFORSECS * 1000)
const STARTFULLBRIGHTNESSATHOURS = parseInt(process.env.STARTFULLBRIGHTNESSATHOURS)
const ENDFULLBRIGHTNESSATHOURS = parseInt(process.env.ENDFULLBRIGHTNESSATHOURS)

const NIGHTBRIGHTNESS = parseInt(process.env.NIGHTBRIGHTNESS)
const DAYBRIGHTNESS = parseInt(process.env.DAYBRIGHTNESS)

const nightNotificationStream =  new Observable(subscriber => {      
    new CronJob(
        `0 ${ENDFULLBRIGHTNESSATHOURS} * * *`,
       function() {
        subscriber.next({action:'night_time'});
       },
       null,
       true,
       'Europe/London'
   );
});
const dayNotificationStream =  new Observable(subscriber => {      
    new CronJob(
        `0 ${STARTFULLBRIGHTNESSATHOURS} * * *`,
       function() {
           subscriber.next({action:'day_time'});
       },
       null,
       true,
       'Europe/London'
   );
});




console.log(`starting stairs lights current time ${new Date()}`)

const rawGroundFloorRotationSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x0c4314fffef7f65a', function(content){    
            subscriber.next({content})
    });
});

const rawSecondFloorRotationSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x0c4314fffeb064fb', function(content){    
            subscriber.next({content})
    });
});

const rotationCoreSensor = merge(rawGroundFloorRotationSensor,rawSecondFloorRotationSensor).pipe(
    filter( m => m.content.action)
)

const sharedRotatiobStream = rotationCoreSensor.pipe(share())

const onOffStream = sharedRotatiobStream.pipe(
    filter( m => m.content.action==='play_pause'),
    mapTo({action:'switch_onOff'})
)

const rotationSensorStream = sharedRotatiobStream.pipe(
    filter( m => m.content.action==='rotate_right' ||  m.content.action==='rotate_left' || m.content.action==='rotate_stop'),
    map( m => ({action: m.content.action})),
    distinctUntilChanged((prev, curr) => prev.action === curr.action),
    share()
)

const onRotationStream = rotationSensorStream.pipe(
    filter( m => m.action==='rotate_right' ||  m.action==='rotate_left')
)
const onStopStream = rotationSensorStream.pipe(
    filter( m => m.action==='rotate_stop')
)
const leftRightStream = onRotationStream.pipe(
    flatMap( m => interval(30).pipe(

        startWith(1),
        takeUntil(onStopStream),
        mapTo(m)
    )));

const getDefaultBrihtness = () => (new Date().getHours() > STARTFULLBRIGHTNESSATHOURS && new Date().getHours() < ENDFULLBRIGHTNESSATHOURS)? DAYBRIGHTNESS : NIGHTBRIGHTNESS

const brightnessActionStream = merge(onOffStream,leftRightStream,dayNotificationStream, nightNotificationStream).pipe(
    scan((acc, curr) => {
        if (curr.action==='day_time') return {value:DAYBRIGHTNESS}
        if (curr.action==='night_time') return {value:NIGHTBRIGHTNESS}
        if (curr.action==='switch_onOff') return {value:(acc.value==0 ? getDefaultBrihtness() : 0)}
        if (curr.action==='rotate_right') return { value: acc.value + 1 > 1000 ? 1000 : acc.value + 1 } 
        if (curr.action==='rotate_left') return {value: acc.value - 1 < 1 ? 1 : acc.value - 1 }
        
    }, {value:0}),
    share()
)

const currenttBrigthnessStream = brightnessActionStream.pipe(
    startWith({value:getDefaultBrihtness()}),
    shareReplay(1)
)
currenttBrigthnessStream.subscribe(async m => {
   
    
})




const groundfloorSensorStream = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData(GROUND_FLOOR_SENSOR_TOPIC, function(content){  
        if (content.occupancy){      
            subscriber.next({content})
        }
    });
});
const firstFloorSensorStream = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData(FIRST_FLOOR_SENSOR_TOPIC, function(content){        
        if (content.occupancy){      
            subscriber.next({content})
        }
    });
});
const secondfloorSensorStream = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData(SECOND_FLOOR_SENSOR_TOPIC, function(content){        
        if (content.occupancy){      
            subscriber.next({content})
        }
    });
});



const brightnessOffActionStream  = brightnessActionStream.pipe(
    debounceTime(KEEPLIGHTONFORSECS),
    mapTo({type:'brightness_action_off'}),
    )

const brightnessOnActionStream  = brightnessActionStream.pipe(
    map(m => ({type:'brightness_action_on', value : m.value})),
    )

const brightnessChangeObservable = merge(brightnessOnActionStream,brightnessOffActionStream).pipe(share())


const getStairsObservable = (sensorStreams) => {
    const sharedStreams = merge(sensorStreams).pipe(share())

    const lightsOffStream = sharedStreams.pipe(
        debounceTime(KEEPLIGHTONFORSECS),
        mapTo({type:'movement_off'}),
        )
    const lightsOnStream = sharedStreams.pipe(
        withLatestFrom(currenttBrigthnessStream),
        map(([_, brightness]) =>  ({type:'movement_on', value: brightness.value})),
    )
    return merge(lightsOnStream, lightsOffStream)
}

const getMergedObservable = (o) => merge(o,brightnessChangeObservable)
.pipe(
    scan((acc, curr) => {
        if (curr.type==='brightness_action_on') return curr        
        if (curr.type==='movement_on') return curr;
        
        if (curr.type==='brightness_action_off') {
            if (acc.type==='brightness_action_on') return {type: curr.type, value:0}
            else return acc;
        }
        if (curr.type==='movement_off') {
            if (acc.type==='movement_on') return {type: curr.type, value:0}
            else return acc;
        }
    }, {type: null, value:0}),
    distinctUntilChanged((prev, curr) => prev.type === curr.type && prev.value === curr.value),
)


getMergedObservable(getStairsObservable(merge(groundfloorSensorStream,firstFloorSensorStream)))
.subscribe(async m => {
    //console.log('Downstairs', m);
    (await mqtt.getClusterAsync()).publishMessage('stairs/down/light',`${m.value}`)
})


getMergedObservable(getStairsObservable(merge(secondfloorSensorStream,firstFloorSensorStream)))
.subscribe(async m => {
    //console.log('Upstairs', m);
    (await mqtt.getClusterAsync()).publishMessage('stairs/up/light',`${m.value}`)
})


