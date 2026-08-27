import type { LightDevice, LightState } from "./light.js";

export class MockLight implements LightDevice {
  private state: LightState = "off";

  public constructor(public readonly deviceId: string) {}

  public async turnOn(): Promise<LightState> {
    this.state = "on";
    return this.state;
  }

  public getState(): LightState {
    return this.state;
  }
}