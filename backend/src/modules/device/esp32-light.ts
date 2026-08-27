import type { LightDevice, LightState } from "./light.js";

export interface Esp32Transport {
  turnOn(deviceId: string): Promise<void>;
}

export class Esp32Light implements LightDevice {
  public constructor(
    public readonly deviceId: string,
    private readonly transport: Esp32Transport,
  ) {}

  public async turnOn(): Promise<LightState> {
    await this.transport.turnOn(this.deviceId);
    return "on";
  }
}