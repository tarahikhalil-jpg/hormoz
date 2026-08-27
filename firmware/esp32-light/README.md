# ESP32 light firmware

This is an Arduino-ESP32 sketch for the safe simulation stage. It turns on the
board's built-in LED only; do not connect mains voltage, a real relay, or an
electrical load.

## HTTP contract

The firmware accepts only:

```http
POST /api/v1/lights/light-777/turn-on
Content-Type: application/json
```

```json
{"action":"light.turn_on","deviceId":"light-777"}
```

A valid request returns HTTP 200 and turns the LED on. Missing fields return
400. An unsupported action returns 400. An unknown device returns 404.

The endpoint and payload match `HttpEsp32Transport` in
`backend/src/modules/device/http-esp32-transport.ts`.

## Configuration and flashing

The repository has no ESP32 toolchain configured. Install Arduino IDE with the
Espressif ESP32 board package, copy `config.example.h` to `config.h`, provide
local Wi-Fi values, select the board and serial port, then upload
`src/esp32_light.ino`. Keep `config.h` uncommitted and never put credentials in
source control.

Host-side tests for the controller can be run from `tests` with a standard C++
compiler and do not use Wi-Fi or any network connection.