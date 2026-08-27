import { buildApp } from "./app.js";
import { Esp32Light } from "./modules/device/esp32-light.js";
import { HttpEsp32Transport } from "./modules/device/http-esp32-transport.js";

const esp32BaseUrl = process.env.ESP32_BASE_URL;
if (!esp32BaseUrl?.trim()) {
  throw new Error("ESP32_BASE_URL is required");
}

const app = buildApp({
  light: new Esp32Light("light-777", new HttpEsp32Transport({ baseUrl: esp32BaseUrl })),
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const start = async () => {
  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
