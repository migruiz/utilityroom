const { Observable, Subject, merge, of, race, timer } = require('rxjs');var mqtt = require('./mqttCluster.js');
const {  map,shareReplay,startWith, filter,switchMap, take, mapTo, tap} = require('rxjs/operators');
var http = require('http');

global.mtqqLocalPath = process.env.MQTTLOCAL;

const DOOR_SENSOR = 'zigbee2mqtt/0x00158d0007ecd814'    // Aqara door sensor
const MASTER_BUTTON = 'zigbee2mqtt/0x94deb8fffe57b8ff'  // IKEA TRADFRI shortcut button
const LIGHT = 'zigbee2mqtt/0x00124b0024c2eaf7'          // Sonoff ZBMINI relay on the light
// The master switch, retained, so a restart carries on where it was: {"enabled": true|false}.
const MASTER_TOPIC = 'utilityroom/master'
// The kitchen iPad's "All lights" screen: GET/POST /utility-room, passed through by nginx on
// the Pi (the screens container in C:/repos/home-assistant).
const SCREEN_PORT = 8768


const rawDoorSensor = new Observable(async subscriber => {
    var mqttCluster=await mqtt.getClusterAsync()
    mqttCluster.subscribeData(DOOR_SENSOR, function(content){
            subscriber.next(content)
    });
});

const masterSwitchSensor = new Observable(async subscriber => {
    var mqttCluster=await mqtt.getClusterAsync()
    mqttCluster.subscribeData(MASTER_BUTTON, function(content){
            subscriber.next(content)
    });
});

const lightSensor = new Observable(async subscriber => {
    var mqttCluster=await mqtt.getClusterAsync()
    mqttCluster.subscribeData(LIGHT, function(content){
            subscriber.next(content)
    });
});

const savedMaster = new Observable(async subscriber => {
    var mqttCluster=await mqtt.getClusterAsync()
    mqttCluster.subscribeData(MASTER_TOPIC, function(content){
            subscriber.next(content.enabled !== false)
    });
});


const doorSensor = rawDoorSensor.pipe( map(m => !m.contact),shareReplay(1))


// The button: a short press ('on') turns the master switch on, a long press
// ('brightness_move_up', then 'brightness_stop' on release) turns it off.
const masterButtonStream = masterSwitchSensor.pipe(
    filter( c=> c.action==='on' || c.action==='brightness_stop' || c.action==='brightness_move_up')
    ,map(m => ({enabled: m.action==='on', from: 'button'}))
)

// The screen's master switch: the same two presses as the button.
const screenControl = new Subject()
const screenStream = screenControl.pipe(map(enabled => ({enabled, from: 'screen'})))

// What was saved before a restart; on when nothing was, as it always started.
const startingMaster = race(savedMaster.pipe(take(1)), timer(5000).pipe(mapTo(true)))

let master = null    // the master switch, once the saved one is known
let doorOpen = null  // what the door sensor last said
let lightOn = null   // what the relay last said

const masterSwitchStream = startingMaster.pipe(
    switchMap(saved => merge(masterButtonStream, screenStream).pipe(startWith({enabled: saved, from: 'saved'}))),
    tap(async m => {
        master = m.enabled
        console.log(`${new Date().toISOString()} master ${m.enabled ? 'on' : 'off'} (${m.from})`)
        if (m.from !== 'saved') (await mqtt.getClusterAsync()).publishData(MASTER_TOPIC, {enabled: m.enabled}, {retain: true})
    }),
    map(m => m.enabled)
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
    (await mqtt.getClusterAsync()).publishData(LIGHT + '/set',{state})
})

doorSensor.subscribe(open => { doorOpen = open })
lightSensor.subscribe(m => { if (m.state) lightOn = m.state === 'ON' })
// The relay only says when it changes: ask it once, so the screen knows from the start.
mqtt.getClusterAsync().then(cluster => cluster.publishData(LIGHT + '/get', {state: ''}))


// What the screen shows: the master switch, and the light and door as they last reported
// (null until they have).
function screenState() {
  return { enabled: master, lightOn, doorOpen }
}

http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url !== '/utility-room') return reply(404, { error: 'only /utility-room' });
  if (req.method === 'GET') return reply(200, screenState());
  if (req.method !== 'POST') return reply(405, { error: 'GET or POST /utility-room' });
  let body = '';
  req.on('data', chunk => { body += chunk });
  req.on('end', () => {
    let enabled;
    try { enabled = JSON.parse(body).enabled } catch (e) {}
    if (typeof enabled !== 'boolean') return reply(400, { error: 'send {"enabled": true or false}' });
    // For the first few seconds it is still finding the saved switch.
    if (master === null) return reply(503, { error: 'starting, try again' });
    // Runs through the streams above at once, so the reply already has the new switch.
    screenControl.next(enabled);
    reply(200, screenState());
  });
}).listen(SCREEN_PORT, () => console.log(`screen requests on port ${SCREEN_PORT}`));
