import type { LightDevice } from "../device/light.js";
import type { Action, ActionResult } from "./types.js";

export interface ActionDispatcherOptions {
  light: LightDevice;
}

export class ActionDispatcher {
  private readonly light: LightDevice;

  public constructor(options: ActionDispatcherOptions) {
    this.light = options.light;
  }

  public async dispatch(action: Action): Promise<ActionResult> {
    if (action.action !== "light.turn_on" || action.deviceId !== this.light.deviceId) {
      throw new Error(`Unsupported action target: ${action.action}/${action.deviceId}`);
    }
    await this.light.turnOn();
    return { success: true, action: action.action, deviceId: action.deviceId, state: "on" };
  }
}