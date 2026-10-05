# utilityroom

The utility room light. On the main Pi as the Portainer stack "utilityroom" (container
`utilityroom`), talking to Zigbee2MQTT over MQTT:

- the **door sensor** (`0x00158d0007ecd814`): while the switch is on, the light is on while the
  door is open and off when it closes;
- the **IKEA shortcut button** (`0x94deb8fffe57b8ff`) inside the door: a short press turns the
  switch on, a long press turns it off (and the light with it, whatever the door does);
- the **kitchen iPad**'s lights screen (`C:/repos/home-assistant/screens`, "All lights" on the
  home screen): a second way to press the button, through the screens nginx at
  `/utility-room`, passed on to port 8768 here. `GET /utility-room` is
  `{enabled, lightOn, doorOpen}` (`null` until reported), `POST {"enabled": true|false}` is a
  press;
- the **relay** (`0x00124b0024c2eaf7`, Sonoff ZBMINI) switches the light.

The switch is kept on MQTT as `utilityroom/master` (`{"enabled": …}`, retained), so a restart
carries on where it was; with nothing saved it starts on.

## Deploy

The image is built on Windows and loaded on the Pi (CircleCI's Docker Hub build is old):

```bash
docker buildx build --builder multi --platform linux/arm/v7 -f rpi/Dockerfile -t migruiz/utilityroom:latest --load .
docker save migruiz/utilityroom:latest | ssh pi docker load
```

then recreate the container from the stack's compose file
(`MainRaspberryHome/stacks/utilityroom.yml` in `C:/repos/portainer-stacks`, which publishes
port 8768). Portainer keeps its copy in
`/var/lib/docker/volumes/portainer_data/_data/compose/28/MainRaspberryHome/stacks/utilityroom.yml`:

```bash
ssh pi "sudo docker compose -p utilityroom -f /var/lib/docker/volumes/portainer_data/_data/compose/28/MainRaspberryHome/stacks/utilityroom.yml up -d"
```
