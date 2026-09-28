import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const page = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>هوش هرمز | نوا</title>

<style>
* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family: Tahoma, Arial, sans-serif;
  background: #07141d;
  color: #fff;
}

.hero {
  min-height: 100vh;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background:
    linear-gradient(
      rgba(0,0,0,.28),
      rgba(0,0,0,.62)
    ),
    url("/hormoz.jpg") center/cover no-repeat;
  padding: 30px 20px;
}

.hero-content {
  max-width: 850px;
  width: 100%;
}

.logo {
  width: 92px;
  height: 92px;
  margin: 0 auto 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.35);
  backdrop-filter: blur(8px);
  font-size: 28px;
  font-weight: bold;
}

h1 {
  margin: 0 0 14px;
  font-size: clamp(38px, 8vw, 76px);
}

.subtitle {
  font-size: clamp(18px, 4vw, 27px);
  line-height: 1.8;
  margin: 0 auto 20px;
}

.quote {
  font-size: 16px;
  line-height: 2;
  opacity: .92;
  margin-bottom: 28px;
}

.buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

button,
.chat-button {
  border: none;
  border-radius: 14px;
  padding: 13px 22px;
  font-size: 16px;
  cursor: pointer;
  text-decoration: none;
  color: #fff;
  background: rgba(255,255,255,.17);
  border: 1px solid rgba(255,255,255,.28);
}

button:hover,
.chat-button:hover {
  background: rgba(255,255,255,.28);
}

.music-button {
  position: fixed;
  left: 18px;
  top: 18px;
  z-index: 10;
  padding: 10px 14px;
  font-size: 14px;
}

.chat-section {
  min-height: 100vh;
  padding: 70px 18px;
  background: #07141d;
}

.chat-box {
  max-width: 850px;
  margin: auto;
}

.chat-title {
  text-align: center;
  margin-bottom: 30px;
}

.chat-title h2 {
  font-size: 32px;
  margin-bottom: 10px;
}

.messages {
  min-height: 330px;
  max-height: 55vh;
  overflow-y: auto;
  padding: 18px;
  border-radius: 20px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
}

.message {
  padding: 12px 15px;
  border-radius: 15px;
  margin-bottom: 12px;
  line-height: 1.9;
  white-space: pre-wrap;
}

.user {
  background: rgba(255,255,255,.1);
}

.nava {
  background: rgba(0,160,180,.18);
}

.input-row {
  display: flex;
  gap: 10px;
  margin-top: 15px;
}

input {
  flex: 1;
  min-width: 0;
  padding: 15px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.15);
  background: rgba(255,255,255,.08);
  color: white;
  font-size: 16px;
  outline: none;
}

.send {
  background: #087f8c;
  min-width: 90px;
}

footer {
  text-align: center;
  padding: 30px 15px;
  background: #050d13;
  opacity: .8;
  font-size: 13px;
}

@media (max-width: 600px) {
  .input-row {
    flex-direction: column;
  }

  .send {
    width: 100%;
  }
}
</style>
</head>

<body>

<button class="music-button" id="musicButton">
🎵 موسیقی
</button>

<audio id="backgroundMusic" loop preload="none">
  <source src="/hormoz-music.mp3" type="audio/mpeg">
</audio>

<section class="hero">

  <div class="hero-content">

    <div class="logo">
      هرمز
    </div>

    <h1>هوش هرمز</h1>

    <p class="subtitle">
      نوا، دستیار هوشمند هرمز
    </p>

    <p class="quote">
      نوا کمک می‌کند، هرمز هماهنگ می‌کند، انسان تصمیم می‌گیرد.
    </p>

    <div class="buttons">
      <a class="chat-button" href="#chat">
        ورود به گفت‌وگو با نوا
      </a>
    </div>

  </div>

</section>

<section class="chat-section" id="chat">

  <div class="chat-box">

    <div class="chat-title">
      <h2>گفت‌وگو با نوا</h2>
      <p>سلام کن؛ نوا آماده است.</p>
    </div>

    <div class="messages" id="messages">
      <div class="message nava">
        سلام 🌹 من نوا هستم، دستیار هوش هرمز.
        چطور می‌تونم کمکت کنم؟
      </div>
    </div>

    <div class="input-row">
      <input
        id="messageInput"
        type="text"
        placeholder="پیامت را بنویس..."
        autocomplete="off"
      />

      <button class="send" id="sendButton">
        ارسال
      </button>
    </div>

  </div>

</section>

<footer>
  هوش هرمز • نوا
  <br>
  رؤیا • تلاش • ادامه
</footer>

<script>
const API = "/api/v1/chat";

const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const music = document.getElementById("backgroundMusic");
const musicButton = document.getElementById("musicButton");

let musicOn = false;

musicButton.addEventListener("click", async () => {
  try {
    if (!musicOn) {
      await music.play();
      musicOn = true;
      musicButton.textContent = "🔇 توقف موسیقی";
    } else {
      music.pause();
      musicOn = false;
      musicButton.textContent = "🎵 موسیقی";
    }
  } catch (error) {
    musicButton.textContent = "🎵 پخش نشد";
  }
});

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message) return;

  addMessage(message, "user");
  input.value = "";
  sendButton.disabled = true;

  try {
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "public"
      },
      body: JSON.stringify({
        message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        "خطا در ارتباط با نوا"
      );
    }

    const answer =
      data.content ||
      data.response ||
      data.message ||
      "پاسخی دریافت نشد.";

    addMessage(answer, "nava");

  } catch (error) {
    addMessage(
      "فعلاً ارتباط با نوا برقرار نشد. لطفاً دوباره امتحان کن.",
      "nava"
    );
  }

  sendButton.disabled = false;
  input.focus();
}

sendButton.addEventListener("click", sendMessage);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});
</script>

</body>
</html>
`;

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: true });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/",
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

  const memoryService = new MemoryService({
    memoryRepository,
  });

  const light =
    options.light ??
    new MockLight("light-777");

  const intelligenceEngine =
    new MockIntelligenceEngine(
      new OpenRouterIntelligenceProvider()
    );

  app.register(chatRoutes, {
    memoryService,
    conversationService,
    identityService,
    intelligenceEngine,
    actionDispatcher: new ActionDispatcher({
      light,
    }),
  });

  app.register(conversationRoutes, {
    conversationService,
    identityService,
  });

  app.register(healthRoutes);

  app.register(memoryRoutes, {
    memoryService,
  });

  app.get("/", async (_request, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .send(page);
  });

  app.get("/chat", async (_request, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .send(page);
  });

  return app;
}