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

const page = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1,viewport-fit=cover"
  >

  <meta name="theme-color" content="#111814">
  <meta
    name="description"
    content="هوش هرمز — گفت‌وگو با نوا"
  >

  <title>هوش هرمز | نوا</title>

  <style>
    :root {
      --dark: #101613;
      --dark2: #18211d;
      --sand: #f5efe4;
      --white: #fffdf9;
      --ink: #202522;
      --muted: #747b75;
      --line: rgba(255,255,255,.16);
      --accent: #d49a57;
      --user: #edf3f0;
      --nava: #fff3dc;
      --danger: #fff0ee;
      --shadow: 0 22px 70px rgba(0,0,0,.22);
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      background: var(--dark);
      color: var(--white);
      font-family:
        Tahoma,
        "Noto Sans Arabic",
        Arial,
        sans-serif;
    }

    button,
    input {
      font: inherit;
    }

    .hero {
      position: relative;
      min-height: 72vh;
      display: flex;
      align-items: flex-end;
      overflow: hidden;
      background:
        linear-gradient(
          to bottom,
          rgba(10,15,13,.05),
          rgba(10,15,13,.82)
        ),
        url("/hormoz.jpg") center/cover no-repeat;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(
          90deg,
          rgba(0,0,0,.20),
          transparent 55%,
          rgba(0,0,0,.28)
        );
      pointer-events: none;
    }

    .hero-inner {
      position: relative;
      z-index: 2;
      width: min(980px,100%);
      margin: auto;
      padding: 28px 18px 48px;
    }

    .topbar {
      position: absolute;
      z-index: 5;
      top: 0;
      left: 0;
      right: 0;
      width: min(980px,100%);
      margin: auto;
      padding: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 900;
      text-shadow: 0 2px 12px rgba(0,0,0,.45);
    }

    .logo {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,.92);
      color: #8e4f32;
      font-weight: 900;
      font-size: 13px;
      box-shadow: 0 8px 30px rgba(0,0,0,.20);
    }

    .music {
      border: 1px solid rgba(255,255,255,.25);
      background: rgba(0,0,0,.28);
      color: #fff;
      border-radius: 999px;
      padding: 9px 14px;
      cursor: pointer;
      backdrop-filter: blur(10px);
    }

    .hero-content {
      max-width: 720px;
    }

    .hero h1 {
      margin: 0;
      font-size: clamp(42px,9vw,76px);
      line-height: 1;
      letter-spacing: -2px;
      text-shadow: 0 4px 25px rgba(0,0,0,.45);
    }

    .hero p {
      max-width: 620px;
      margin: 18px 0 0;
      color: rgba(255,255,255,.88);
      font-size: clamp(15px,2.5vw,19px);
      line-height: 2;
      text-shadow: 0 2px 12px rgba(0,0,0,.45);
    }

    .quote {
      display: inline-block;
      margin-top: 20px;
      padding: 12px 17px;
      border-radius: 17px;
      background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.20);
      backdrop-filter: blur(10px);
      line-height: 1.9;
      font-weight: 700;
    }

    .content {
      width: min(920px,100%);
      margin: auto;
      padding: 18px 14px 45px;
    }

    .intro {
      padding: 22px;
      border-radius: 25px;
      background: var(--white);
      color: var(--ink);
      box-shadow: var(--shadow);
    }

    .intro h2 {
      margin: 0 0 10px;
      font-size: 20px;
    }

    .intro p {
      margin: 7px 0;
      color: #555c56;
      line-height: 2;
      font-size: 14px;
    }

    .principle {
      margin-top: 16px;
      padding: 13px;
      text-align: center;
      border-radius: 15px;
      background: #f8f1e5;
      font-weight: 800;
    }

    .chat {
      margin-top: 16px;
      background: var(--white);
      color: var(--ink);
      border-radius: 25px;
      padding: 20px;
      box-shadow: var(--shadow);
    }

    .chat-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 14px;
      border-bottom: 1px solid #e7dfd2;
    }

    .avatar {
      width: 45px;
      height: 45px;
      display: grid;
      place-items: center;
      border-radius: 15px;
      background: #fff0d2;
      font-size: 22px;
    }

    .chat-head strong {
      display: block;
    }

    .chat-head span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }

    #messages {
      min-height: 300px;
      max-height: 55vh;
      overflow-y: auto;
      padding: 14px 2px;
    }

    .message {
      display: flex;
      margin: 9px 0;
    }

    .message.user {
      justify-content: flex-start;
    }

    .message.nava,
    .message.error {
      justify-content: flex-end;
    }

    .bubble {
      max-width: 90%;
      padding: 12px 14px;
      border-radius: 18px;
      line-height: 1.9;
      white-space: pre-wrap;
      font-size: 14px;
    }

    .user .bubble {
      background: var(--user);
      border: 1px solid #dce6e1;
      border-bottom-left-radius: 6px;
    }

    .nava .bubble {
      background: var(--nava);
      border: 1px solid #ecdcbf;
      border-bottom-right-radius: 6px;
    }

    .error .bubble {
      color: #8b3d32;
      background: var(--danger);
      border: 1px solid #efcfc9;
    }

    .typing {
      display: inline-flex;
      gap: 4px;
    }

    .typing i {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #8c765c;
      animation: pulse .9s infinite alternate;
    }

    .typing i:nth-child(2) {
      animation-delay: .2s;
    }

    .typing i:nth-child(3) {
      animation-delay: .4s;
    }

    @keyframes pulse {
      to {
        opacity: .25;
        transform: translateY(-2px);
      }
    }

    .composer {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #e7dfd2;
    }

    .composer input {
      flex: 1;
      min-width: 0;
      padding: 14px;
      border: 1px solid #dcd4c7;
      border-radius: 16px;
      outline: none;
      background: #fff;
      font-size: 14px;
    }

    .composer button {
      min-width: 80px;
      border: 0;
      border-radius: 16px;
      background: #252b27;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }

    .composer button:disabled {
      opacity: .5;
      cursor: wait;
    }

    .hint {
      margin-top: 9px;
      color: #92958f;
      text-align: center;
      font-size: 11px;
    }

    .footer {
      padding: 22px 10px;
      text-align: center;
      color: rgba(255,255,255,.60);
      font-size: 12px;
      line-height: 2;
    }

    @media (max-width: 650px) {
      .hero {
        min-height: 68vh;
      }

      .hero-inner {
        padding-bottom: 32px;
      }

      .bubble {
        max-width: 94%;
      }
    }
  </style>
</head>

<body>

  <section class="hero">

    <div class="topbar">

      <div class="brand">
        <div class="logo">
          هرمز
        </div>

        <div>
          هوش هرمز
        </div>
      </div>

      <button
        id="musicButton"
        class="music"
        type="button"
        aria-label="پخش موسیقی"
      >
        ♫ موسیقی
      </button>

    </div>

    <div class="hero-inner">

      <div class="hero-content">

        <h1>هوش هرمز</h1>

        <p>
          یک فضای ساده و انسانی برای گفت‌وگو با نوا؛
          دستیار هوش مصنوعی پروژه هرمز.
        </p>

        <div class="quote">
          «نوا کمک می‌کند، هرمز هماهنگ می‌کند، انسان تصمیم می‌گیرد.»
        </div>

      </div>

    </div>

  </section>

  <audio
    id="backgroundMusic"
    loop
    preload="none"
  >
    <source
      src="/hormoz-music.mp3"
      type="audio/mpeg"
    >
  </audio>

  <main class="content">

    <section class="intro">

      <h2>🌱 درباره هرمز</h2>

      <p>
        هرمز با یک ایده ساده شروع شد:
        فناوری هوشمند باید برای انسان قابل‌دسترس،
        قابل‌فهم و کاربردی باشد.
      </p>

      <p>
        این پروژه در حال رشد و آزمایش است
        و تلاش می‌کند واقعیت را همان‌طور که هست نشان دهد.
      </p>

      <div class="principle">
        امنیت، سپس هوشمندی و اتصال.
      </div>

    </section>

    <section class="chat" aria-label="گفت‌وگو با نوا">

      <div class="chat-head">

        <div class="avatar">
          🎵
        </div>

        <div>
          <strong>نوا</strong>
          <span>
            دستیار هوش مصنوعی هرمز
          </span>
        </div>

      </div>

      <div id="messages" aria-live="polite">

        <div class="message nava">

          <div class="bubble">
            سلام 🌹
            <br>
            من نوا هستم.
            <br>
            چه کمکی از من برمی‌آید؟
          </div>

        </div>

      </div>

      <div class="composer">

        <input
          id="messageInput"
          type="text"
          autocomplete="off"
          placeholder="پیامت را برای نوا بنویس..."
          aria-label="پیام"
        >

        <button
          id="sendButton"
          type="button"
        >
          ارسال
        </button>

      </div>

      <div class="hint">
        Enter برای ارسال • اطلاعات حساس را وارد نکنید.
      </div>

    </section>

  </main>

  <footer class="footer">
    رؤیا • تلاش • ادامه
    <br>
    <strong>777</strong>
  </footer>

  <script>

    const API = "/api/v1/chat";

    const messages =
      document.getElementById("messages");

    const input =
      document.getElementById("messageInput");

    const sendButton =
      document.getElementById("sendButton");

    const music =
      document.getElementById("backgroundMusic");

    const musicButton =
      document.getElementById("musicButton");


    function addMessage(text, type) {

      const row =
        document.createElement("div");

      row.className =
        "message " + type;

      const bubble =
        document.createElement("div");

      bubble.className =
        "bubble";

      bubble.textContent =
        text;

      row.appendChild(bubble);

      messages.appendChild(row);

      messages.scrollTop =
        messages.scrollHeight;

      return row;
    }


    function showTyping() {

      const row =
        document.createElement("div");

      row.id =
        "typing";

      row.className =
        "message nava";

      row.innerHTML =
        '<div class="bubble">' +
        '<span class="typing">' +
        '<i></i><i></i><i></i>' +
        '</span>' +
        '</div>';

      messages.appendChild(row);

      messages.scrollTop =
        messages.scrollHeight;
    }


    async function sendMessage() {

      const message =
        input.value.trim();

      if (!message ||
          sendButton.disabled) {

        return;
      }

      addMessage(
        message,
        "user"
      );

      input.value = "";

      sendButton.disabled =
        true;

      showTyping();

      try {

        const response =
          await fetch(API, {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "x-user-id":
                "public"
            },

            body: JSON.stringify({
              message
            })
          });


        const data =
          await response
            .json()
            .catch(() => ({}));


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


        document
          .getElementById("typing")
          ?.remove();


        addMessage(
          answer,
          "nava"
        );


      } catch (error) {

        document
          .getElementById("typing")
          ?.remove();


        addMessage(
          "ارتباط با نوا برقرار نشد: " +
          (error?.message ||
            "خطای نامشخص"),
          "error"
        );


      } finally {

        sendButton.disabled =
          false;

        input.focus();
      }
    }


    sendButton.addEventListener(
      "click",
      sendMessage
    );


    input.addEventListener(
      "keydown",
      function(event) {

        if (event.key === "Enter") {
          sendMessage();
        }

      }
    );


    musicButton.addEventListener(
      "click",
      async function() {

        if (music.paused) {

          try {

            await music.play();

            musicButton.textContent =
              "❚❚ موسیقی";

          } catch {

            musicButton.textContent =
              "♫ موسیقی";

          }

        } else {

          music.pause();

          musicButton.textContent =
            "♫ موسیقی";
        }

      }
    );

  </script>

</body>
</html>`;


export function buildApp(
  options: AppOptions = {}
) {

  const app = Fastify({
    logger: true
  });


  const identityService =
    new IdentityService({

      userRepository:
        new InMemoryUserRepository(),

      sessionRepository:
        new InMemorySessionRepository(),

    });


  const conversationService =
    new ConversationService({

      conversationRepository:
        new InMemoryConversationRepository(),

      identityService,

    });


  const memoryRepository =
    new InMemoryMemoryRepository();


  const memoryService =
    new MemoryService({

      memoryRepository

    });


  const light =
    options.light ??
    new MockLight("light-777");


  const intelligenceEngine =
    new MockIntelligenceEngine(
      new OpenRouterIntelligenceProvider()
    );


  app.register(
    chatRoutes,
    {
      memoryService,
      conversationService,
      identityService,
      intelligenceEngine,

      actionDispatcher:
        new ActionDispatcher({
          light
        }),
    }
  );


  app.register(
    conversationRoutes,
    {
      conversationService,
      identityService,
    }
  );


  app.register(
    healthRoutes
  );


  app.register(
    memoryRoutes,
    {
      memoryService
    }
  );


  app.get(
    "/",
    async (_request, reply) => {

      return reply
        .type("text/html; charset=utf-8")
        .send(page);

    }
  );


  app.get(
    "/chat",
    async (_request, reply) => {

      return reply
        .type("text/html; charset=utf-8")
        .send(page);

    }
  );


  return app;
}