import type { IntelligenceRequest } from "./intelligence-engine.js";

export interface IntelligenceProvider {
  generate(request: IntelligenceRequest): Promise<string>;
}