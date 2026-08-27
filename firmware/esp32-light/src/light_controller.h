#pragma once

#include <string>

namespace hormoz::firmware {

inline constexpr const char* kDeviceId = "light-777";
inline constexpr const char* kTurnOnPath = "/api/v1/lights/light-777/turn-on";

class LightOutput {
 public:
  virtual ~LightOutput() = default;
  virtual void setOn() = 0;
};

struct HttpResponse {
  int status;
  std::string body;
};

class LightController {
 public:
  HttpResponse handleTurnOn(const std::string& path,
                            const std::string& body,
                            LightOutput& output) const;
};

}  // namespace hormoz::firmware