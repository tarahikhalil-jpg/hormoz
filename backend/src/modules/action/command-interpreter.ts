import type { Action } from "./types.js";

const turnOnLightCommand = "چراغ را روشن کن";

export function interpretCommand(message: string): Action | null {
  if (message.trim() !== turnOnLightCommand) return null;
  return { action: "light.turn_on", deviceId: "light-777" };
}