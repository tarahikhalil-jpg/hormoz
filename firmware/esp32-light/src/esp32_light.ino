#include <WebServer.h>
#include <WiFi.h>

#include "config.h"
#include "light_controller.h"

namespace {

class LedOutput final : public hormoz::firmware::LightOutput {
 public:
  explicit LedOutput(int pin) : pin_(pin) {
    pinMode(pin_, OUTPUT);
    digitalWrite(pin_, LOW);
  }

  void setOn() override { digitalWrite(pin_, HIGH); }

 private:
  int pin_;
};

WebServer server(80);
LedOutput output(STATUS_LED_PIN);
hormoz::firmware::LightController controller;

void handleTurnOn() {
  const auto response = controller.handleTurnOn(
      "/api/v1/lights/light-777/turn-on", server.arg("plain").c_str(), output);
  server.send(response.status, "application/json", response.body.c_str());
}

}  // namespace

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(250);

  server.on("/api/v1/lights/light-777/turn-on", HTTP_POST, handleTurnOn);
  server.onNotFound([]() {
    server.send(404, "application/json",
                "{\"success\":false,\"error\":\"NOT_FOUND\"}");
  });
  server.begin();
}

void loop() { server.handleClient(); }