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
import { MockIntelligenceEngine } from "./modules/intelligence/mock-intelligence-engine.js";
import { OpenRouterIntelligenceProvider } from "./modules/intelligence/openrouter-intelligence-provider.js";

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

  const intelligenceEngine = new MockIntelligenceEngine(
    new OpenRouterIntelligenceProvider(),
  );

  app.register(chatRoutes, {
    memoryService,
    conversationService,
    identityService,
    intelligenceEngine,
    actionDispatcher: new ActionDispatcher({ light }),
  });

  app.register(conversationRoutes, {
    conversationService,
    identityService,
  });

  app.register(healthRoutes);
  app.register(memoryRoutes, { memoryService });

  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hormoz AI — Nava</title>
  <style>
    body {
      margin: 0;
      font-family: sans-serif;
      background: #f4efe6;
      color: #222;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 16px;
    }

    .card {
      background: white;
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 8px 30px rgba(0,0,0,.08);
    }

    h1 {
      margin-top: 0;
      text-align: center;
    }

    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 24px;
    }

    #messages {
      min-height: 260px;
      max-height: 55vh;
      overflow-y: auto;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 14px;
      background: #fafafa;
      margin-bottom: 14px;
    }

    .message {
      padding: 12px;
      margin: 8px 0;
      border-radius: 12px;
      line-height: 1.8;
      white-space: pre-wrap;
    }

    .user {
      background: #e8f1ff;
    }

    .nava {
      background: #fff3d6;
    }

    .error {
      background: #ffe6e6;
    }

    .input-row {
      display: flex;
      gap: 8px;
    }

    input {
      flex: 1;
      padding: 14px;
      border: 1px solid #ccc;
      border-radius: 12px;
      font-size: 16px;
    }

    button {
      padding: 14px 20px;
      border: 0;
      border-radius: 12px;
      background: #222;
      color: white;
      font-size: 16px;
    }

    button:disabled {
      opacity: .5;
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="card">
      <h1>🌹 هرمز AI</h1>
      <div class="subtitle">نوا — دستیار هوشمند هرمز</div>

      <div id="messages">
        <div class="message nava">
          سلام بابا خلیل 🌹<br>
          من نوا هستم. منتظرم با من صحبت کنی.
        </div>
      </div>

      <div class="input-row">
        <input
          id="messageInput"
          type="text"
          placeholder="پیامت را برای نوا بنویس..."
        />
        <button id="sendButton">ارسال</button>
      </div>
    </div>
  </div>

  <script>
    const messages = document.getElementById("messages");
    const input = document.getElementById("messageInput");
    const button = document.getElementById("sendButton");

    function addMessage(text, type) {
      const div = document.createElement("div");
      div.className = "message " + type;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    async function sendMessage() {
      const message = input.value.trim();

      if (!message || button.disabled) {
        return;
      }

      addMessage(message, "user");
      input.value = "";
      button.disabled = true;

      try {
        const response = await fetch(
          "https://hormoz-ai-backend-777.onrender.com/api/v1/chat",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": "khalil"
            },
            body: JSON.stringify({
              message
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.message ||
            data?.error?.message ||
            data?.error ||
            "خطا در دریافت پاسخ"
          );
        }

        const answer =
          data?.content ||
          data?.response ||
          data?.message ||
          "نوا پاسخ خالی فرستاد.";

        addMessage(answer, "nava");

      } catch (error) {
        addMessage(
          "ارتباط با نوا برقرار نشد: " +
          (error?.message || "خطای نامشخص"),
          "error"
        );
      } finally {
        button.disabled = false;
        input.focus();
      }
    }

    button.addEventListener("click", sendMessage);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
  </script>
</body>
</html>`);
  });

  return app;
}