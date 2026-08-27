export interface TurnOnLightAction {
  action: "light.turn_on";
  deviceId: "light-777";
}

export type Action = TurnOnLightAction;

export interface ActionResult {
  success: true;
  action: Action["action"];
  deviceId: Action["deviceId"];
  state: "on";
}