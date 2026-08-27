export type LightState = "off" | "on";

export interface LightDevice {
  readonly deviceId: string;
  turnOn(): Promise<LightState>;
}