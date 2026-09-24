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
  <title>هوش هرمز | Hormoz Intelligence</title>

  <style>
    body {
      margin: 0;
      font-family: sans-serif;
      background: #f4efe6;
      color: #222;
    }

    .container {
      max-width: 760px;
      margin: 0 auto;
      padding: 24px 16px 50px;
    }

    .hero,
    .card {
      background: white;
      border-radius: 22px;
      padding: 24px;
      margin-bottom: 18px;
      box-shadow: 0 8px 30px rgba(0,0,0,.08);
    }

    .hero {
      text-align: center;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 30px;
    }

    h2 {
      margin-top: 0;
    }

    .subtitle {
      color: #666;
      font-size: 17px;
      line-height: 1.8;
    }

    .nava-intro {
      margin-top: 20px;
      padding: 18px;
      border-radius: 16px;
      background: #fff3d6;
      line-height: 2;
      text-align: right;
    }

    .card {
      line-height: 2;
    }

    .principle {
      font-weight: bold;
      text-align: center;
      padding: 18px;
      margin-top: 15px;
      border-radius: 16px;
      background: #f7f1e4;
    }

    .chat-title {
      text-align: center;
      margin-bottom: 16px;
    }

    #messages {
      min-height: 220px;
      max-height: 50vh;
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

    .footer {
      text-align: center;
      color: #777;
      font-size: 14px;
      margin-top: 25px;
    }
  </style>
</head>

<body>
  <div class="container">

    <section class="hero">
      <h1>🌹 هوش هرمز</h1>
      <div class="subtitle">
        Hormoz Intelligence
        <br>
        یک پروژه نوپا برای نزدیک‌تر کردن فناوری هوشمند به انسان
      </div>

      <div class="nava-intro">
        <strong>سلام، من نوا هستم.</strong>
        <br>
        دستیار هوش مصنوعی پروژه هوش هرمز.
        <br>
        هدف من کمک به انسان برای یادگیری، فهمیدن، حل مسئله، ساختن و تصمیم‌گیری بهتر است.
      </div>
    </section>

    <section class="card">
      <h2>🌱 هرمز برای چیست؟</h2>

      <p>
        هوش هرمز فقط یک صفحه اینترنتی یا یک کسب‌وکار هوشمند نیست.
      </p>

      <p>
        این پروژه از یک سؤال ساده شروع شده است:
        اگر فناوری هوشمند می‌تواند به انسان کمک کند،
        چرا استفاده از آن نباید برای کسانی که امکانات مالی یا فنی کمتری دارند
        هم ساده‌تر و قابل دسترس‌تر باشد؟
      </p>

      <p>
        هرمز یک پروژه نوپاست که با امکانات محدود،
        یادگیری، آزمون‌وخطا و تلاش مداوم ساخته شده است.
      </p>

      <p>
        هنوز کامل نیست.
        بعضی امکانات در حال توسعه و آزمایش هستند.
      </p>

      <div class="principle">
        «نوا کمک می‌کند، هرمز هماهنگ می‌کند، انسان تصمیم می‌گیرد.»
      </div>
    </section>

    <section class="card">
      <h2>🤝 چرا این صفحه ساخته شده؟</h2>

      <p>
        فعلاً از شما نمی‌خواهیم به هرمز اعتماد کنید.
      </p>

      <p>
        فقط می‌خواهیم آن را ببینید،
        با ایده آن آشنا شوید و اگر فرصتی داشتید
        نظر واقعی خودتان را بگویید.
      </p>

      <p>
        اگر این ایده برای شما ارزش داشت،
        می‌توانید آن را به دیگران معرفی کنید.
      </p>

      <p>
        اگر فکر می‌کنید جایی اشتباه کرده‌ایم،
        همان را هم به ما بگویید.
      </p>
    </section>

    <section class="card">
      <h2 class="chat-title">💬 گفت‌وگو با نوا</h2>

      <div id="messages">
        <div class="message nava">
          سلام 🌹
          <br>
          من نوا هستم.
          <br>
          اگر اتصال هوش مصنوعی در دسترس باشد،
          می‌توانی با من صحبت کنی.
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
    </section>

    <div class="footer">
      رؤیا • تلاش • ادامه
      <br>
      777
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