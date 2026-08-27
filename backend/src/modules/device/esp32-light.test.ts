import assert from "node:assert/strict";
import { Esp32Light, type Esp32Transport } from "./esp32-light.js";
import {
  Esp32TransportError,
  HttpEsp32Transport,
  type FetchFunction,
} from "./http-esp32-transport.js";

class SpyTransport implements Esp32Transport {
  public deviceIds: string[] = [];
  public shouldFail = false;

  public async turnOn(deviceId: string): Promise<void> {
    this.deviceIds.push(deviceId);
    if (this.shouldFail) throw new Error("transport unavailable");
  }
}

const transport = new SpyTransport();
const light = new Esp32Light("light-777", transport);

assert.equal(await light.turnOn(), "on");
assert.deepEqual(transport.deviceIds, ["light-777"]);

transport.shouldFail = true;
await assert.rejects(() => light.turnOn(), /transport unavailable/);
assert.deepEqual(transport.deviceIds, ["light-777", "light-777"]);

const requests: Array<{ input: string; init?: RequestInit }> = [];
const successfulFetch: FetchFunction = async (input, init) => {
  requests.push({ input, init });
  return new Response(null, { status: 204 });
};
const httpTransport = new HttpEsp32Transport({
  baseUrl: "http://esp32.test",
  fetch: successfulFetch,
  turnOnPath: (deviceId) => `/turn-on/${deviceId}`,
});
const httpLight = new Esp32Light("light-777", httpTransport);

assert.equal(await httpLight.turnOn(), "on");
assert.equal(requests[0]?.input, "http://esp32.test/turn-on/light-777");
assert.equal(requests[0]?.init?.method, "POST");
assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
  action: "light.turn_on",
  deviceId: "light-777",
});

const httpErrorTransport = new HttpEsp32Transport({
  baseUrl: "http://esp32.test",
  fetch: async () => new Response(null, { status: 503 }),
});
await assert.rejects(
  () => new Esp32Light("light-777", httpErrorTransport).turnOn(),
  (error: unknown) => error instanceof Esp32TransportError
    && error.code === "HTTP_ERROR"
    && error.status === 503,
);

const networkErrorTransport = new HttpEsp32Transport({
  baseUrl: "http://esp32.test",
  fetch: async () => { throw new Error("connection refused"); },
});
await assert.rejects(
  () => new Esp32Light("light-777", networkErrorTransport).turnOn(),
  (error: unknown) => error instanceof Esp32TransportError && error.code === "NETWORK_ERROR",
);

const timeoutTransport = new HttpEsp32Transport({
  baseUrl: "http://esp32.test",
  timeoutMs: 10,
  fetch: (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }),
});
await assert.rejects(
  () => new Esp32Light("light-777", timeoutTransport).turnOn(),
  (error: unknown) => error instanceof Esp32TransportError && error.code === "TIMEOUT",
);

console.log("ESP32_LIGHT_TEST: PASS");