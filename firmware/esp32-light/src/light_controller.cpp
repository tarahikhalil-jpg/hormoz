#include "light_controller.h"

namespace hormoz::firmware {
namespace {

bool readJsonString(const std::string& body, const std::string& key,
                    std::string& value) {
  const std::string field = "\"" + key + "\"";
  const std::size_t fieldStart = body.find(field);
  if (fieldStart == std::string::npos) return false;

  const std::size_t colon = body.find(':', fieldStart + field.size());
  if (colon == std::string::npos) return false;
  const std::size_t openingQuote = body.find('"', colon + 1);
  if (openingQuote == std::string::npos) return false;
  const std::size_t closingQuote = body.find('"', openingQuote + 1);
  if (closingQuote == std::string::npos) return false;

  value = body.substr(openingQuote + 1, closingQuote - openingQuote - 1);
  return true;
}

HttpResponse errorResponse(int status, const char* code, const char* message) {
  return {status, "{\"success\":false,\"error\":\"" +
                      std::string(code) + "\",\"message\":\"" + message +
                      "\"}"};
}

}  // namespace

HttpResponse LightController::handleTurnOn(const std::string& path,
                                           const std::string& body,
                                           LightOutput& output) const {
  if (path != kTurnOnPath) {
    return errorResponse(404, "NOT_FOUND", "unsupported endpoint");
  }

  std::string action;
  std::string deviceId;
  if (!readJsonString(body, "action", action) ||
      !readJsonString(body, "deviceId", deviceId)) {
    return errorResponse(400, "INVALID_PAYLOAD", "action and deviceId are required");
  }
  if (action != "light.turn_on") {
    return errorResponse(400, "INVALID_ACTION", "unsupported action");
  }
  if (deviceId != kDeviceId) {
    return errorResponse(404, "UNKNOWN_DEVICE", "unsupported deviceId");
  }

  output.setOn();
  return {200, "{\"success\":true,\"action\":\"light.turn_on\",\"deviceId\":\"light-777\",\"state\":\"on\"}"};
}

}  // namespace hormoz::firmware