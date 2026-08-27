#include <cassert>
#include <string>

#include "../src/light_controller.h"

namespace {

class FakeOutput final : public hormoz::firmware::LightOutput {
 public:
  void setOn() override { isOn = true; }
  bool isOn = false;
};

void testValidCommandTurnsOutputOn() {
  FakeOutput output;
  hormoz::firmware::LightController controller;
  const auto response = controller.handleTurnOn(
      hormoz::firmware::kTurnOnPath,
      R"({"action":"light.turn_on","deviceId":"light-777"})", output);

  assert(response.status == 200);
  assert(output.isOn);
  assert(response.body.find("\"deviceId\":\"light-777\"") != std::string::npos);
}

void testRejectsInvalidCommands() {
  hormoz::firmware::LightController controller;
  FakeOutput output;

  assert(controller.handleTurnOn(
      hormoz::firmware::kTurnOnPath,
      R"({"action":"light.turn_on","deviceId":"light-999"})", output).status == 404);
  assert(controller.handleTurnOn(
      hormoz::firmware::kTurnOnPath,
      R"({"action":"light.turn_off","deviceId":"light-777"})", output).status == 400);
  assert(controller.handleTurnOn(
      hormoz::firmware::kTurnOnPath,
      R"({"action":"light.turn_on"})", output).status == 400);
  assert(!output.isOn);
}

}  // namespace

int main() {
  testValidCommandTurnsOutputOn();
  testRejectsInvalidCommands();
}