import Fastify from "fastify";
import { chatRoutes } from "./routes/chat.js";
import { ActionDispatcher } from "./modules/action/dispatcher.js";
import type { LightDevice } from "./modules/device/light.js";
import { MockLight } from "./modules/device/mock-light.js";
import { conversationRoutes } from "./routes/conversation.js";
import { healthRoutes } from "./routes/health.js";
import { memoryRoutes } from "./routes/memory.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { InMemorySessionRepository } from "./modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "./modules/identity/repositories/user.repository.js";
import { InMemoryConversationRepository } from "./modules/conversation/repository.js";
import { ConversationService } from "./modules/conversation/service.js";
import { InMemoryMemoryRepository } from "./modules/memory/repository.js";
import { MemoryService } from "./modules/memory/service.js";

export interface AppOptions {
  light?: LightDevice;
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: true
  });
  const identityService = new IdentityService({
    userRepository: new InMemoryUserRepository(),
    sessionRepository: new InMemorySessionRepository(),
  });
  const conversationService = new ConversationService({
    conversationRepository: new InMemoryConversationRepository(),
    identityService,
  });
  const memoryRepository = new InMemoryMemoryRepository();
  const memoryService = new MemoryService({ memoryRepository });
  const light = options.light ?? new MockLight("light-777");

  app.register(chatRoutes, {
    memoryService,
    conversationService,
    identityService,
    actionDispatcher: new ActionDispatcher({ light }),
  });
  app.register(conversationRoutes, { conversationService, identityService });
  app.register(healthRoutes);
  app.register(memoryRoutes, { memoryService });

  return app;
}
