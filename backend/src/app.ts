import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

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
import { adminRoutes, recordPublicVisit } from "./routes/admin.js";
import { imageGenerationRoutes } from "./routes/image-generation.js";
import { globalOrderRoutes } from "./routes/global-orders.js";

export interface AppOptions {
  light?: LightDevice;
}

const page = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<meta
  name="google-site-verification"
  content="QQe7jYuEkWdr-b1plnCDAVUnqKLDLwRV0-bqrjSN7W4"
>

<meta
  name="description"
  content="هوش هرمز؛ نوا کمک می‌کند، هرمز هماهنگ می‌کند، انسان تصمیم می‌گیرد."
>

<title>هوش هرمز | نوا</title>

<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/jpeg" href="/hormoz.jpg">
<meta name="theme-color" content="#111827">

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

/* ===== HERO ===== */

.hero {
  min-height: 100vh;
  position: relative;

  display: flex;
  align-items: center;
  justify-content: center;

  text-align: center;

  background:
    linear-gradient(
      rgba(0,0,0,.25),
      rgba(0,0,0,.72)
    ),
    url("/hormoz.jpg")
    center / cover no-repeat;

  padding: 30px 20px;
}

.hero-content {
  max-width: 900px;
  width: 100%;
}

.logo {
  width: 110px;
  height: 110px;

  margin: 0 auto 24px;

  border-radius: 32px;

  display: flex;
  align-items: center;
  justify-content: center;

  position: relative;

  background:
    linear-gradient(
      145deg,
      rgba(0,220,220,.30),
      rgba(255,255,255,.10)
    );

  border:
    1px solid
    rgba(120,240,255,.45);

  backdrop-filter: blur(12px);

  box-shadow:
    0 0 35px rgba(0,210,220,.22),
    0 15px 45px rgba(0,0,0,.35);

  overflow: hidden;
}

.logo::before {
  content: "";

  position: absolute;

  width: 70px;
  height: 35px;

  border-radius: 50%;

  border-top: 4px solid #66f7f1;
  border-bottom: 4px solid rgba(80,220,230,.45);

  transform: rotate(-12deg);

  box-shadow:
    0 0 18px rgba(80,240,240,.45);
}

.logo::after {
  content: "777";

  position: absolute;

  bottom: 9px;

  font-size: 10px;

  letter-spacing: 3px;

  opacity: .75;
}

.logo-text {
  position: relative;
  z-index: 2;

  font-size: 25px;
  font-weight: bold;

  text-shadow:
    0 2px 12px rgba(0,0,0,.55);
}

h1 {
  margin: 0 0 14px;

  font-size:
    clamp(38px, 8vw, 76px);

  text-shadow:
    0 4px 20px rgba(0,0,0,.5);
}

.subtitle {
  font-size:
    clamp(18px, 4vw, 27px);

  line-height: 1.8;

  margin: 0 auto 20px;

  text-shadow:
    0 3px 12px rgba(0,0,0,.5);
}

.quote {
  font-size: 17px;

  line-height: 2;

  opacity: .95;

  margin-bottom: 28px;

  text-shadow:
    0 3px 10px rgba(0,0,0,.55);
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

  background:
    rgba(255,255,255,.17);

  border:
    1px solid
    rgba(255,255,255,.28);

  backdrop-filter: blur(7px);

  transition: .2s ease;
}

button:hover,
.chat-button:hover {
  background:
    rgba(255,255,255,.28);

  transform:
    translateY(-1px);
}

/* ===== MUSIC ===== */

.music-button {
  position: fixed;

  left: 18px;
  top: 18px;

  z-index: 20;

  padding: 10px 14px;

  font-size: 14px;

  background:
    rgba(0,0,0,.38);

  backdrop-filter:
    blur(8px);
}

/* ===== PROJECT ===== */

.project-section {
  padding: 75px 18px;

  background:
    radial-gradient(
      circle at top,
      #123d4d 0,
      #081b26 45%,
      #061119 100%
    );
}

.project-box {
  max-width: 850px;

  margin: auto;

  text-align: center;
}

.project-box h2 {
  margin: 0 0 18px;

  font-size:
    clamp(28px, 6vw, 42px);
}

.project-box h2::after {
  content: "";

  display: block;

  width: 70px;
  height: 3px;

  margin: 14px auto 0;

  border-radius: 5px;

  background: #5ce7e0;
}

.project-box p {
  font-size: 17px;

  line-height: 2.2;

  opacity: .9;

  margin:
    0 auto 20px;
}

.principles {
  display: grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(190px, 1fr)
    );

  gap: 14px;

  margin-top: 35px;
}

.principle {
  padding: 22px 15px;

  border-radius: 20px;

  background:
    rgba(255,255,255,.055);

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 15px 35px
    rgba(0,0,0,.15);
}

.principle-icon {
  font-size: 28px;

  margin-bottom: 8px;
}

.principle strong,
.principle h3 {
  display: block;

  margin:
    0 0 7px;

  font-size: 17px;
}

.principle span {
  font-size: 13px;

  line-height: 1.9;

  opacity: .75;
}

.principle a {
  display: inline-block;

  margin-top: 10px;

  color: #66f7f1;

  text-decoration: none;

  font-size: 14px;
}

.principle a:hover {
  text-decoration: underline;
}

.motto {
  margin-top: 35px;

  padding: 22px;

  border-radius: 20px;

  background:
    linear-gradient(
      135deg,
      rgba(0,190,200,.12),
      rgba(255,255,255,.05)
    );

  border:
    1px solid
    rgba(80,230,230,.18);

  font-size: 18px;

  line-height: 2;
}

/* ===== CHAT ===== */

.chat-section {
  min-height: 100vh;

  padding: 70px 18px;

  background:
    radial-gradient(
      circle at top,
      #103242 0,
      #07141d 45%,
      #050d13 100%
    );
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

.chat-title p {
  opacity: .75;
}

.messages {
  min-height: 330px;

  max-height: 55vh;

  overflow-y: auto;

  padding: 18px;

  border-radius: 20px;

  background:
    rgba(255,255,255,.06);

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 20px 50px
    rgba(0,0,0,.18);
}

.message {
  padding: 12px 15px;

  border-radius: 15px;

  margin-bottom: 12px;

  line-height: 1.9;

  white-space: pre-wrap;
}

.user {
  background:
    rgba(255,255,255,.10);
}

.nava {
  background:
    rgba(0,160,180,.18);

  border:
    1px solid
    rgba(0,200,220,.08);
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

  border:
    1px solid
    rgba(255,255,255,.15);

  background:
    rgba(255,255,255,.08);

  color: white;

  font-size: 16px;

  outline: none;
}

input:focus {
  border-color:
    rgba(0,200,220,.5);
}

.send {
  background: #087f8c;

  min-width: 90px;
}

.send:disabled {
  opacity: .55;

  cursor: wait;
}

.voice-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.voice-button {
  flex: 1 1 180px;
  min-height: 50px;
  border: 1px solid rgba(92,231,224,.38);
  border-radius: 14px;
  padding: 12px 15px;
  background: rgba(8,127,140,.22);
  color: #fff;
  font: inherit;
  font-weight: bold;
}
.voice-button[aria-pressed="true"] {
  background: rgba(8,127,140,.42);
  border-color: #5ce7e0;
}
.voice-status {
  min-height: 28px;
  margin: 8px 2px 0;
  color: #b8e9e7;
  font-size: 14px;
  line-height: 1.8;
}

/* ===== ADMIN ===== */

textarea {
  font-family:
    Tahoma,
    Arial,
    sans-serif;
}

#adminRequest {
  width: 100%;

  min-height: 110px;

  padding: 14px;

  border-radius: 14px;

  border:
    1px solid
    rgba(255,255,255,.15);

  background:
    rgba(255,255,255,.07);

  color: white;

  font-size: 15px;

  line-height: 1.9;

  outline: none;

  resize: vertical;
}

#adminRequest:focus {
  border-color:
    rgba(0,200,220,.5);
}

#adminResult {
  min-height: 30px;

  padding: 5px;

  line-height: 2;

  white-space: pre-wrap;
}

/* ===== FEEDBACK ===== */

.feedback-section {
  padding: 65px 18px;

  background:
    radial-gradient(
      circle at top,
      #12333e 0,
      #07141d 55%,
      #050d13 100%
    );
}

.feedback-box {
  max-width: 850px;

  margin: auto;

  padding: 28px 22px;

  border-radius: 22px;

  background:
    rgba(255,255,255,.055);

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 20px 50px
    rgba(0,0,0,.18);
}

.feedback-title {
  text-align: center;

  margin-bottom: 28px;
}

.feedback-title h2 {
  margin: 0 0 10px;

  font-size:
    clamp(26px, 6vw, 36px);
}

.feedback-title p {
  margin: 0;

  line-height: 1.9;

  opacity: .75;
}

.feedback-question {
  margin-top: 24px;
}

.feedback-question > strong {
  display: block;

  margin-bottom: 12px;

  line-height: 1.8;
}

.feedback-options {
  display: flex;

  flex-wrap: wrap;

  gap: 10px;
}

.feedback-option {
  display: flex;

  align-items: center;

  gap: 7px;

  padding: 10px 13px;

  border-radius: 13px;

  background:
    rgba(255,255,255,.06);

  border:
    1px solid
    rgba(255,255,255,.10);

  cursor: pointer;
}

.feedback-option input {
  flex: none;

  width: auto;

  padding: 0;

  accent-color: #5ce7e0;
}

.feedback-textarea {
  width: 100%;

  min-height: 95px;

  resize: vertical;

  padding: 13px;

  border-radius: 14px;

  border:
    1px solid
    rgba(255,255,255,.15);

  background:
    rgba(255,255,255,.07);

  color: white;

  font-family:
    Tahoma,
    Arial,
    sans-serif;

  font-size: 15px;

  line-height: 1.8;

  outline: none;
}

.feedback-textarea:focus {
  border-color:
    rgba(0,200,220,.5);
}

.feedback-submit {
  width: 100%;

  margin-top: 24px;

  background: #087f8c;
}

.feedback-submit:disabled {
  opacity: .65;

  cursor: default;

  transform: none;
}

.feedback-message {
  min-height: 26px;

  margin: 14px 0 0;

  text-align: center;

  line-height: 1.8;
}

.feedback-note {
  display: block;

  margin-top: 18px;

  text-align: center;

  line-height: 1.9;

  opacity: .55;

  font-size: 12px;
}

/* ===== FOOTER ===== */

footer {
  text-align: center;

  padding: 35px 15px;

  background: #050d13;

  opacity: .85;

  font-size: 13px;

  line-height: 2.2;
}

.footer-main {
  font-size: 15px;

  margin-bottom: 5px;
}

.footer-motto {
  opacity: .7;
}

/* ===== MOBILE ===== */

@media (max-width: 600px) {

  .hero {
    padding: 25px 16px;
  }

  .logo {
    width: 88px;
    height: 88px;

    border-radius: 27px;
  }

  .logo-text {
    font-size: 20px;
  }

  .logo::before {
    width: 58px;
    height: 29px;
  }

  .input-row {
    flex-direction: column;
  }

  .send {
    width: 100%;
  }

  .music-button {
    left: 12px;
    top: 12px;
  }

  .project-section,
  .chat-section,
  .feedback-section {
    padding:
      55px 15px;
  }

  .feedback-box {
    padding:
      24px 16px;
  }

  .feedback-options {
    flex-direction: column;
  }

  .feedback-option {
    width: 100%;
  }

}

</style>

</head>

<body>

<!-- ===== MUSIC ===== -->

<button
  class="music-button"
  id="musicButton"
  type="button"
>
  🎵 موسیقی
</button>

<audio
  id="backgroundMusic"
  loop
  preload="none"
>
  <source
    src="/hormoz-music%20(1).mp3"
    type="audio/mpeg"
  >
</audio>


<!-- ===== HERO ===== -->

<section class="hero">

  <div class="hero-content">

    <div
      class="logo"
      aria-label="لوگوی هوش هرمز"
    >
      <span class="logo-text">
        هرمز
      </span>
    </div>

    <h1>
      هوش هرمز
    </h1>

    <p class="subtitle">
      نوا، دستیار هوشمند هرمز
    </p>

    <p class="quote">
      نوا کمک می‌کند،
      هرمز هماهنگ می‌کند،
      انسان تصمیم می‌گیرد.
    </p>

    <div class="buttons">

      <a
        class="chat-button"
        href="#chat"
      >
        ورود به گفت‌وگو با نوا
      </a>

      <a
        class="chat-button"
        href="/contact-admin.html"
      >
        ارتباط مستقیم با مدیر
      </a>

      <a
        class="chat-button"
        href="/agency-connect.html"
      >
        🏢 اتصال اداره‌ها و سازمان‌ها
      </a>

      <a
        class="chat-button"
        href="/opportunities.html"
      >
        🤝 فرصت‌ها و معرفی خدمات
      </a>

      <a
        class="chat-button"
        href="/market.html"
      >
        🌴 بازار هرمز؛ ویترین تولیدکنندگان
      </a>

      <a
        class="chat-button"
        href="/about.html"
      >
        درباره هرمز
      </a>

    </div>
  </div>
</section>


<!-- ===== PROJECT INTRO ===== -->

<section class="project-section">

  <div class="project-box">

    <h2>
      درباره هوش هرمز
    </h2>

    <img
      src="/hormoz.jpg"
      alt="پوستر هوش هرمز"
      style="
        display:block;
        width:100%;
        max-width:760px;
        height:auto;
        margin:0 auto 28px;
        border-radius:22px;
        box-shadow:0 18px 45px rgba(0,0,0,.28);
      "
    >

    <p>
      هوش هرمز یک پروژه انسان‌محور
      برای ساختن فضایی امن،
      ساده و در دسترس برای
      گفت‌وگو و استفاده از
      هوش مصنوعی است.
    </p>

    <p>
      هدف ما این است که فناوری
      فقط برای کسانی نباشد
      که امکانات بیشتری دارند؛
      هر انسانی که ایده،
      پرسش یا نیازی دارد
      باید بتواند با احترام
      و سادگی با آن ارتباط بگیرد.
    </p>

    <div class="principles">

      <div class="principle">

        <div class="principle-icon">
          🔐
        </div>

        <strong>
          امنیت
        </strong>

        <span>
          امنیت و حریم خصوصی
          از اصول اساسی هرمز است.
        </span>

      </div>

      <div class="principle">

        <div class="principle-icon">
          🤝
        </div>

        <strong>
          انسان‌محوری
        </strong>

        <span>
          فناوری در خدمت انسان
          و انتخاب آگاهانه اوست.
        </span>

      </div>

      <div class="principle">

        <div class="principle-icon">
          🧠
        </div>

        <strong>
          هوشمندی
        </strong>

        <span>
          نوا برای کمک،
          گفت‌وگو و همراهی ساخته شده است.
        </span>

      </div>

    </div>

    <div class="motto">

      <strong>
        اول امنیت، بعد اتصال و هوشمندی.
      </strong>

      <br>

      نوا کمک می‌کند،
      هرمز هماهنگ می‌کند،
      انسان تصمیم می‌گیرد.

      <br><br>

      <strong>
        رؤیا • تلاش • ادامه
      </strong>

    </div>

    <div class="buttons">

      <a
        class="chat-button"
        href="#chat"
      >
        ورود به گفت‌وگو با نوا
      </a>

      <a
        class="chat-button"
        href="/contact-admin.html"
      >
        ارتباط مستقیم با مدیر
      </a>

      <a
        class="chat-button"
        href="https://suno.com/s/0Z2pLQ7obkL3lUCW"
        target="_blank"
        rel="noopener noreferrer"
      >
        🎵 شنیدن آهنگ «چراغ روشن نگه دار»
      </a>

    </div>
  </div>
</section>


<!-- ===== HORMOZ SONG: CHERAGH ESHGH MA ===== -->

<section class="project-section" id="hormoz-song">
  <div class="project-box">
    <h2>🎵 چراغ عشق ما</h2>
    <p>
      این آهنگ را با عشق برای هوش هرمز ساخته‌ایم؛
      چراغ امید، تلاش و همراهی انسان‌ها.
    </p>
    <div style="max-width:760px;margin:24px auto;border-radius:20px;overflow:hidden;border:1px solid rgba(92,231,224,.25);box-shadow:0 18px 45px rgba(0,0,0,.28);">
      <iframe
        title="پخش آهنگ چراغ عشق ما - هوش هرمز"
        src="https://suno.com/embed/34741c43-1564-4e20-a53f-eecb27385aa1"
        width="100%"
        height="240"
        frameborder="0"
        allow="autoplay; encrypted-media"
        loading="lazy"
        style="display:block;border:0;background:#07141d;"
      ></iframe>
    </div>
    <p class="motto">
      🕯️ رؤیا • تلاش • ادامه<br>
      چراغ ۷۷۷ برای خاموش شدن ساخته نشده.
    </p>
    <div class="buttons">
      <a class="chat-button"
        href="https://suno.com/song/34741c43-1564-4e20-a53f-eecb27385aa1"
        target="_blank" rel="noopener noreferrer">
        باز کردن آهنگ در Suno
      </a>
    </div>
  </div>
</section>



<!-- ===== INCOME ===== -->

<section class="project-section">

  <div class="project-box">

    <h2>
      💰 مسیر درآمد هرمز
    </h2>

    <p>
      هرمز فقط برای گفتگو نیست؛
      هدف آن کمک به تبدیل توانایی و خلاقیت انسان
      به ارزش و درآمد واقعی است.
    </p>

    <div class="principles">

      <div class="principle">

        <div class="principle-icon">
          🖋️
        </div>

        <h3>
          آثار نوشتاری
        </h3>

        <p>
          شعر، ترانه، داستان، نمایشنامه و فیلمنامه
        </p>

        <a
          href="https://adibjoo.ir/"
          target="_blank"
          rel="noopener noreferrer"
        >
          مسیر آثار ادبی و هنری
        </a>

      </div>

      <div class="principle">

        <div class="principle-icon">
          🎵
        </div>

        <h3>
          پروژه‌های موسیقی
        </h3>

        <p>
          ترانه‌سرایی، آهنگسازی و همکاری موسیقی
        </p>

        <a
          href="https://www.saazino.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          پروژه‌های موسیقی
        </a>

      </div>

      <div class="principle">

        <div class="principle-icon">
          🎼
        </div>

        <h3>
          فروش ترانه و ملودی
        </h3>

        <p>
          معرفی آثار برای همکاری یا فروش
        </p>

        <a
          href="https://enzohekmat.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          مسیر فروش و همکاری
        </a>

      </div>

    </div>

    <p class="motto">
      هدف هرمز شهرت نیست؛
      هدف، تبدیل توانایی واقعی انسان به ارزش و درآمد پایدار است.
    </p>

  </div>

</section>


<!-- ===== HORMOZ VIDEO ADS ===== -->
<section class="project-section" id="hormoz-video-ads">
  <div class="project-box">
    <h2>🎬 ویدیوهای تبلیغاتی هرمز</h2>
    <p>ویدیوهای معرفی هرمز و آگهی‌های تصویری در این بخش نمایش داده می‌شوند.</p>
    <div style="max-width:850px;margin:22px auto;border-radius:18px;overflow:hidden;border:1px solid rgba(92,231,224,.25);background:#000;">
      <video controls playsinline preload="metadata" poster="/hormoz.jpg" style="display:block;width:100%;max-height:480px;">
        <source src="/hormoz-ad.mp4" type="video/mp4">
        مرورگر شما از پخش ویدیو پشتیبانی نمی‌کند.
      </video>
    </div>
    <p class="motto">برای افزودن یا جایگزینی ویدیو، وارد پنل مدیریت هرمز شوید.</p>
  </div>
</section>

<!-- ===== HORMOZ VIDEO ADS ===== -->
<section class="project-section" id="hormoz-video-ads">
  <div class="project-box">
    <h2>🎬 ویدیوهای تبلیغاتی هرمز</h2>
    <p>ویدیوهای معرفی هرمز و آگهی‌های تصویری در این بخش نمایش داده می‌شوند.</p>
    <div style="max-width:850px;margin:22px auto;border-radius:18px;overflow:hidden;border:1px solid rgba(92,231,224,.25);background:#000;">
      <video controls playsinline preload="metadata" poster="/hormoz.jpg" style="display:block;width:100%;max-height:480px;">
        <source src="/hormoz-ad.mp4" type="video/mp4">
        مرورگر شما از پخش ویدیو پشتیبانی نمی‌کند.
      </video>
    </div>
    <p class="motto">برای افزودن یا جایگزینی ویدیو، وارد پنل مدیریت هرمز شوید.</p>
  </div>
</section>

<!-- ===== SERVICES ===== -->

<section class="project-section">

  <div class="project-box">

    <h2>
      🛠️ خدمات هرمز
    </h2>

    <p>
      هرمز برای حل مسائل واقعی مردم طراحی می‌شود؛
      از امور اداری و فروش تا تبلیغات، سفر و مدیریت ساده کسب‌وکار.
    </p>

    <div class="principles">

      <div class="principle">
        <div class="principle-icon">📢</div>
        <h3>تبلیغات</h3>
        <p>ایده، متن تبلیغاتی و معرفی محصول</p>
      </div>

      <div class="principle">
        <div class="principle-icon">📄</div>
        <h3>امورات اداری</h3>
        <p>نامه، درخواست، فرم و پیگیری امور</p>
      </div>

      <div class="principle">
        <div class="principle-icon">🧾</div>
        <h3>حسابداری و فاکتور</h3>
        <p>ثبت فروش، محاسبات ساده و فاکتور</p>
      </div>

      <div class="principle">
        <div class="principle-icon">🎬</div>
        <h3>کلیپ تبلیغاتی</h3>
        <p>ایده، سناریو و محتوای تبلیغاتی</p>
      </div>

      <div class="principle">
        <div class="principle-icon">🛒</div>
        <h3>فروش</h3>
        <p>معرفی محصول، متن فروش و سفارش‌ها</p>
      </div>

      <div class="principle">
        <div class="principle-icon">✈️</div>
        <h3>سفر و گردشگری</h3>
        <p>سفر، اقامت، رستوران و حمل‌ونقل</p>
      </div>

    </div>

    <p class="motto">
      هرمز برای ساده‌تر کردن کارهای واقعی انسان ساخته می‌شود.
    </p>

  </div>

</section>


<!-- ===== COMMUNITY PARTICIPATION ===== -->

<section class="project-section" id="participate">
  <div class="project-box">
    <h2>هرمز را با هم می‌سازیم</h2>
    <p>
      هرمز یک پروژه در حال توسعه است؛ نه همه امکانات آن آماده است و نه ادعا می‌کنیم
      پاسخ همه نیازها را داریم. می‌خواهیم مردم در شناخت نیازها، تصمیم‌گیری و ساختن
      قدم‌های بعدی شریک باشند.
    </p>
    <div class="principles">
      <div class="principle">
        <div class="principle-icon">💬</div>
        <strong>پیشنهاد و انتقاد</strong>
        <span>بگویید چه چیزی برای شما مفید است و چه چیزی باید بهتر شود.</span>
      </div>
      <div class="principle">
        <div class="principle-icon">🧰</div>
        <strong>معرفی مهارت‌ها</strong>
        <span>توانایی‌ها، ایده‌ها و نیازهای واقعی خود را برای همکاری مطرح کنید.</span>
      </div>
      <div class="principle">
        <div class="principle-icon">🤝</div>
        <strong>مشارکت در ساختن</strong>
        <span>پیشنهادهای مردم باید بررسی شوند و مسیر پیشرفت با صداقت اعلام شود.</span>
      </div>
    </div>
    <p class="motto">
      ما هنوز در آغاز راهیم. امکانات آماده و بخش‌های در حال توسعه را شفاف اعلام می‌کنیم؛
      تصمیم‌های مهم باید با شنیدن صدای انسان‌ها گرفته شوند.
    </p>
    <div class="buttons" style="margin-top:22px;">
      <a class="chat-button" href="/orders.html">ثبت پیشنهاد یا درخواست همکاری</a>
      <a class="chat-button" href="/about.html">بیشتر درباره هدف هرمز</a>
    </div>
  </div>
</section>


<!-- ===== HORMOZ SERVICES ===== -->

<section class="project-section" id="hormoz-services">
  <div class="project-box">
    <h2>🧭 خدمات کاربردی هوش هرمز</h2>
    <p>نیازت را انتخاب کن تا نوا راهنمایی‌ات کند و قدم بعدی را روشن سازد. در این نسخه، راهنمایی و آماده‌سازی مسیر فعال است؛ ثبت سفارش، پرداخت یا خرید مستقیم فقط پس از اتصال و آزمایش رسمی فعال خواهد شد.</p>
    <div class="principles">
      <div class="principle">
        <div class="principle-icon">💧</div>
        <strong>قبض و خدمات شهری</strong>
        <span>آب، برق، گاز و پیگیری از مسیر رسمی.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='برای مشکل آب، برق، گاز یا قبض راهنمایی می‌خواهم. کمک کن مسیر رسمی پیگیری را پیدا کنم.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">شروع راهنمایی</a>
      </div>
      <div class="principle">
        <div class="principle-icon">📶</div>
        <strong>اینترنت و تلفن</strong>
        <span>بررسی مشکل اتصال، تلفن یا انتخاب سرویس.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='برای اینترنت یا تلفن مشکل دارم. کمک کن راه‌حل و مسیر رسمی پیگیری را پیدا کنم.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">بررسی مشکل</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🛶</div>
        <strong>گردشگری و اقامت</strong>
        <span>اقامتگاه، قایق، راهنمای محلی و برنامه سفر.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='برای گردشگری، اقامت یا خدمات قایق در هرمز راهنمایی می‌خواهم. کمک کن نیازم را مشخص کنم و نکات امنیتی را بررسی کنم.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">برنامه‌ریزی سفر</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🚆</div>
        <strong>سفر و بلیت</strong>
        <span>راهنمایی برای مسیر سفر و روش‌های تهیه بلیت.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='برای برنامه‌ریزی سفر و تهیه بلیت راهنمایی می‌خواهم. مقصد و زمان مناسب را با من بررسی کن.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">برنامه‌ریزی سفر</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🧰</div>
        <strong>مهارت و اشتغال</strong>
        <span>تبدیل توانایی‌ها به فرصت واقعی و کم‌هزینه.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='دنبال کار هستم یا مهارتی دارم که می‌خواهم به درآمد تبدیل کنم. از من درباره مهارت، تجربه و شرایط من سؤال کن و قدم‌های عملی پیشنهاد بده.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">شروع راهنمایی شغلی</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🏪</div>
        <strong>کسب‌وکار و تبلیغات</strong>
        <span>معرفی کسب‌وکار، خدمات، محصولات و محتوای تبلیغاتی.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='می‌خواهم کسب‌وکار یا خدمتم را معرفی کنم و تبلیغی روشن و قابل اعتماد آماده کنم. درباره خدمات، مخاطب و راه ارتباط امن از من سؤال کن.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">معرفی کسب‌وکار</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🏛️</div>
        <strong>خدمات اداری</strong>
        <span>فهم مراحل و آماده‌سازی متن و درخواست رسمی.</span>
        <a class="chat-button" href="#chat" onclick="document.getElementById('message').value='برای یک درخواست اداری راهنمایی می‌خواهم. کمک کن مدارک و مسیر رسمی را مشخص کنم و در صورت نیاز متن درخواست را بنویس.'; document.getElementById('chat').scrollIntoView({behavior:'smooth'});">راهنمایی اداری</a>
      </div>
      <div class="principle">
        <div class="principle-icon">🤝</div>
        <strong>همکاری با هرمز</strong>
        <span>ثبت پیشنهاد، معرفی استعداد یا همکاری تخصصی.</span>
        <a class="chat-button" href="/orders.html">ثبت پیشنهاد</a>
      </div>
    </div>
    <p class="motto">امنیت خط قرمز ماست: برای شروع همکاری، رمز عبور، کد یک‌بارمصرف یا اطلاعات بانکی نفرستید.</p>
  </div>
</section>


<!-- ===== ADMIN ASSISTANT ===== -->

<section class="project-section">

  <div class="project-box">

    <h2>
      📄 دستیار امور اداری هرمز
    </h2>

    <p>
      موضوع درخواست خود را بنویسید تا نوا در آماده‌سازی
      یک متن رسمی و منظم به شما کمک کند.
    </p>

    <textarea
      id="adminRequest"
      placeholder="مثلاً: برای درخواست مرخصی یک نامه رسمی می‌خواهم..."
      rows="4"
    ></textarea>

    <button
      id="adminRequestButton"
      type="button"
      style="margin-top:12px;"
    >
      ✍️ آماده‌سازی درخواست
    </button>

    <div
      id="adminResult"
      style="margin-top:15px;"
    ></div>

  </div>

</section>


<!-- ===== CHAT ===== -->

<section
  class="chat-section"
  id="chat"
>

  <div class="chat-box">

    <div class="chat-title">

      <h2>
        گفت‌وگو با نوا
      </h2>

      <img
        src="/hormoz.jpg"
        alt="پوستر هوش هرمز"
        style="
          display:block;
          width:100%;
          max-width:760px;
          height:auto;
          margin:0 auto 28px;
          border-radius:22px;
          box-shadow:0 18px 45px rgba(0,0,0,.28);
        "
      >

      <p>
        سلام کن؛ نوا آماده است.
      </p>

    </div>

    <div
      class="messages"
      id="messages"
    >

      <div class="message nava">

        سلام 🌹
        من نوا هستم،
        دستیار هوش هرمز.

        چطور می‌تونم کمکت کنم؟

      </div>

    </div>

    <div class="input-row">

      <input
        id="message"
        type="text"
        placeholder="پیامت را بنویس..."
        autocomplete="off"
      >

      <button
        class="send"
        id="sendButton"
        type="button"
      >
        ارسال
      </button>

    </div>

    <div class="voice-controls" aria-label="گفت‌وگوی صوتی با نوا">
      <button class="voice-button" id="speechButton" type="button" aria-pressed="false">🎙️ شروع مکالمه صوتی پیوسته</button>
      <button class="voice-button" id="voiceReplyButton" type="button" aria-pressed="true">🔊 پاسخ صوتی: روشن</button>
    </div>
    <p class="voice-status" id="voiceStatus" role="status" aria-live="polite">برای شروع مکالمه، دکمه را بزن و اجازه میکروفون را بده. نوا گوش می‌دهد، پاسخ می‌دهد و پس از پاسخ دوباره گوش می‌دهد.</p>

  </div>

</section>


<!-- ===== FEEDBACK ===== -->

<section
  class="feedback-section"
  id="feedback"
>

  <div class="feedback-box">

    <div class="feedback-title">

      <h2>
        💬 بازخورد شما
      </h2>

      <p>
        اگر با نوا گفت‌وگو کردید،
        تجربه‌تان را با ما در میان بگذارید.
      </p>

    </div>

    <div class="feedback-question">

      <strong>
        ۱. گفت‌وگو با نوا برای شما چطور بود؟
      </strong>

      <div class="feedback-options">

        <label class="feedback-option">
          <input
            type="radio"
            name="fb1"
            value="خیلی خوب"
          >
          خیلی خوب
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb1"
            value="خوب"
          >
          خوب
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb1"
            value="معمولی"
          >
          معمولی
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb1"
            value="ضعیف"
          >
          ضعیف
        </label>

      </div>

    </div>

    <div class="feedback-question">

      <strong>
        ۲. پاسخ‌های نوا چقدر به شما کمک کرد؟
      </strong>

      <div class="feedback-options">

        <label class="feedback-option">
          <input
            type="radio"
            name="fb2"
            value="خیلی زیاد"
          >
          خیلی زیاد
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb2"
            value="تا حدی"
          >
          تا حدی
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb2"
            value="کم"
          >
          کم
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb2"
            value="اصلاً"
          >
          اصلاً
        </label>

      </div>

    </div>

    <div class="feedback-question">

      <strong>
        ۳. آیا دوباره از نوا استفاده می‌کنید؟
      </strong>

      <div class="feedback-options">

        <label class="feedback-option">
          <input
            type="radio"
            name="fb3"
            value="بله"
          >
          بله
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb3"
            value="شاید"
          >
          شاید
        </label>

        <label class="feedback-option">
          <input
            type="radio"
            name="fb3"
            value="خیر"
          >
          خیر
        </label>

      </div>

    </div>

    <div class="feedback-question">

      <strong>
        ۴. چه چیزی را بیشتر دوست داشتید
        یا چه چیزی باید بهتر شود؟
      </strong>

      <textarea
        id="fb4"
        class="feedback-textarea"
        placeholder="نظر شما..."
      ></textarea>

    </div>

    <div class="feedback-question">

      <strong>
        ۵. اگر پیشنهادی برای هوش هرمز دارید، بنویسید:
      </strong>

      <textarea
        id="fb5"
        class="feedback-textarea"
        placeholder="پیشنهاد شما..."
      ></textarea>

    </div>

    <button
      type="button"
      id="sendFeedback"
      class="feedback-submit"
    >
      ارسال بازخورد
    </button>

    <p
      id="feedbackMessage"
      class="feedback-message"
    ></p>

    <small class="feedback-note">
      🔒 این بازخورد در این مرحله بدون نام،
      شماره تلفن و اطلاعات هویتی ثبت می‌شود.
    </small>

  </div>

</section>


<!-- ===== FOOTER ===== -->

<footer>

  <div class="footer-main">
    هوش هرمز • نوا
  </div>

  <div class="footer-motto">
    رؤیا • تلاش • ادامه
    <br>
    چراغ ۷۷۷ برای خاموش شدن ساخته نشده.
  </div>

  <div id="hormoz-visitor-counter" style="margin:18px auto 0;padding:10px 16px;width:max-content;max-width:100%;border:1px solid rgba(120,240,255,.35);border-radius:14px;background:rgba(0,0,0,.22);font-size:14px;color:#d8fbff;">
    👁️ بازدیدهای سایت: <strong id="hormoz-visit-count">در حال دریافت…</strong>
  </div>

</footer>

<script>
(async function loadHormozVisitCount() {
  const output = document.getElementById("hormoz-visit-count");
  if (!output) return;
  try {
    const response = await fetch("/api/v1/visits", { cache: "no-store" });
    if (!response.ok) throw new Error("counter unavailable");
    const data = await response.json();
    output.textContent = Number(data.visits || 0).toLocaleString("fa-IR");
  } catch {
    output.textContent = "فعلاً در دسترس نیست";
  }
})();
</script>


<!-- ===== HORMOZ JAVASCRIPT ===== -->

<script src="/hormoz.js"></script>

</body>
</html>
`;


export function buildApp(
  options: AppOptions = {}
) {

  const app =
    Fastify({
      logger: true
    });

  /* ===== PUBLIC FRONTEND CORS ===== */
  const allowedFrontendOrigins = new Set([
    "https://tarahikhalil-jpg.github.io",
    "https://hormozai.ir",
    "https://www.hormozai.ir",
    "https://hormoz-portal-public-777.onrender.com",
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && allowedFrontendOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, x-user-id, x-session-id");
      reply.header("Access-Control-Max-Age", "86400");
    }

    // Browsers send OPTIONS preflight before the cross-origin JSON chat POST.
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });


  /* ===== PUBLIC VISITS ===== */

  app.addHook(
    "onRequest",
    async (request) => {

      if (
        request.method === "GET" &&
        (
          request.url === "/" ||
          request.url === "/chat"
        )
      ) {

        recordPublicVisit();

      }

    }
  );


  /* ===== MULTIPART ===== */

  app.register(
    multipart,
    {
      limits: {
        fileSize:
          40 * 1024 * 1024,

        files: 1
      }
    }
  );


  /* ===== PATHS ===== */

  const __filename =
    fileURLToPath(
      import.meta.url
    );


  const __dirname =
    path.dirname(
      __filename
    );
/* ===== EXPLICIT SEO FILES ===== */
app.get("/robots.txt", async (_request, reply) => {
const filePath = path.join(__dirname, "../public/robots.txt");
const content = await fs.readFile(filePath, "utf8");
return reply.type("text/plain; charset=utf-8").send(content);
});

app.get("/sitemap.xml", async (_request, reply) => {
const filePath = path.join(__dirname, "../public/sitemap.xml");
const content = await fs.readFile(filePath, "utf8");
return reply.type("application/xml; charset=utf-8").send(content);
});

  /* ===== STATIC FILES ===== */

  app.register(
    fastifyStatic,
    {
      root:
        path.join(
          __dirname,
          "../public"
        ),

      prefix: "/"
    }
  );


  /* ===== NAVA TEXT-TO-SPEECH SERVICE ===== */
  // Dedicated same-origin audio endpoint: the browser never calls a third-party TTS host directly.
  const ttsRequests = new Map<string, { count: number; resetAt: number }>();
  app.post("/api/v1/tts", async (request, reply) => {
    const now = Date.now();
    const clientKey = request.ip || "unknown";
    let usage = ttsRequests.get(clientKey);
    if (!usage || usage.resetAt <= now) {
      usage = { count: 0, resetAt: now + 60_000 };
      ttsRequests.set(clientKey, usage);
    }
    usage.count += 1;
    if (usage.count > 30) {
      return reply.code(429).send({ error: "درخواست‌های صوتی زیاد است؛ یک دقیقه دیگر تلاش کن." });
    }

    const body = request.body as { text?: unknown } | undefined;
    const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return reply.code(400).send({ error: "متن برای تولید صدا خالی است." });
    if (text.length > 220) return reply.code(413).send({ error: "برای پخش پایدار، متن صوتی باید کوتاه‌تر باشد." });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      // If a verified Google Cloud TTS key is configured, prefer its official API.
      const apiKey = process.env.GOOGLE_TTS_API_KEY;
      if (apiKey) {
        const official = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: "fa-XA", name: "fa-XA-Standard-A" },
            audioConfig: { audioEncoding: "MP3", speakingRate: 0.92 }
          }),
          signal: controller.signal
        });
        if (official.ok) {
          const data = await official.json() as { audioContent?: string };
          if (data.audioContent) {
            return reply.header("Cache-Control", "no-store").type("audio/mpeg").send(Buffer.from(data.audioContent, "base64"));
          }
        } else {
          request.log.warn({ status: official.status }, "Official TTS unavailable; trying fallback provider");
        }
      }

      // Pollinations hosted speech: use the project's existing server-side key when configured.
      // Multilingual voice is preferred for Persian; keep the key on the server only.
      const pollinationsKey = process.env.POLLINATIONS_API_KEY;
      if (pollinationsKey) {
        try {
          const pollinations = await fetch("https://gen.pollinations.ai/v1/audio/speech", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + pollinationsKey,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg, audio/*"
            },
            body: JSON.stringify({
              model: "elevenlabs/eleven-multilingual-v2",
              input: text,
              voice: "nova",
              response_format: "mp3"
            }),
            signal: controller.signal
          });
          const contentType = pollinations.headers.get("content-type") || "";
          if (pollinations.ok && contentType.toLowerCase().includes("audio")) {
            const audio = Buffer.from(await pollinations.arrayBuffer());
            if (audio.length > 0) {
              return reply.header("Cache-Control", "no-store").type(contentType.split(";")[0] || "audio/mpeg").send(audio);
            }
          }
          request.log.warn({ status: pollinations.status, contentType }, "Pollinations Nava TTS unavailable; trying Microsoft Edge");
        } catch (error) {
          request.log.warn({ err: error }, "Pollinations Nava TTS request failed; trying Microsoft Edge");
        }
      }

      // Primary no-key Persian neural voice: Microsoft Edge Read Aloud.
      // The newer msedge-tts client sends the current Edge-compatible handshake headers.
      try {
        const edgeTts = new MsEdgeTTS();
        await edgeTts.setMetadata("fa-IR-DilaraNeural", OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
        const { audioStream } = edgeTts.toStream(text, { rate: 0.92 });
        const audioChunks: Buffer[] = [];
        for await (const chunk of audioStream) {
          audioChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const audio = Buffer.concat(audioChunks);
        if (audio.length > 0) {
          return reply.header("Cache-Control", "no-store").type("audio/webm").send(audio);
        }
        request.log.warn("Edge TTS returned an empty audio stream");
      } catch (error) {
        request.log.warn({ err: error }, "Nava Edge Persian TTS unavailable; trying legacy fallback");
      }

      // Try Google's currently supported Translate TTS client modes. One mode may
      // return HTTP 400 while the other still returns a valid Persian audio stream.
      const clients = ["gtx", "tw-ob"];
      let lastStatus = 502;
      for (const client of clients) {
        const params = new URLSearchParams({ ie: "UTF-8", q: text, tl: "fa", client });
        try {
          const upstream = await fetch("https://translate.google.com/translate_tts?" + params.toString(), {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
              "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
              "Referer": "https://translate.google.com/"
            },
            signal: controller.signal
          });
          if (!upstream.ok) {
            lastStatus = upstream.status;
            request.log.warn({ status: upstream.status, client }, "Nava fallback TTS provider rejected request");
            continue;
          }
          const audio = Buffer.from(await upstream.arrayBuffer());
          const contentType = upstream.headers.get("content-type") || "";
          if (audio.length && contentType.toLowerCase().includes("audio")) {
            return reply.header("Cache-Control", "no-store").type("audio/mpeg").send(audio);
          }
          request.log.warn({ client, contentType, bytes: audio.length }, "Nava fallback TTS returned invalid audio");
        } catch (error) {
          lastStatus = controller.signal.aborted ? 504 : lastStatus;
          request.log.warn({ err: error, client }, "Nava fallback TTS request failed; trying next voice endpoint");
          if (controller.signal.aborted) break;
        }
      }
      request.log.error({ lastStatus }, "All Nava fallback TTS modes failed");
      return reply.code(502).send({ error: "سرویس رایگان صدای فارسی در دسترس نیست؛ پاسخ متنی آماده است." });
    } catch (error) {
      request.log.warn({ err: error }, "Nava TTS request failed");
      return reply.code(504).send({ error: "تولید صدا به‌دلیل اتصال یا زمان‌پاسخ‌گویی ناموفق بود." });
    } finally {
      clearTimeout(timeout);
    }
  });

  /* ===== MUSIC ===== */

  app.get(
    "/hormoz-music.mp3",
    async (_request, reply) => {

          const filePath =
        path.join(
          __dirname,
          "../public/hormoz-music (1).mp3"
        );

      const data =
        await fs.readFile(
          filePath
        );

      return reply
        .type("audio/mpeg")
        .send(data);
    }
  );


  /* ===== IDENTITY ===== */

  const identityService =
    new IdentityService({

      userRepository:
        new InMemoryUserRepository(),

      sessionRepository:
        new InMemorySessionRepository()

    });


  /* ===== CONVERSATION ===== */

  const conversationService =
    new ConversationService({

      conversationRepository:
        new InMemoryConversationRepository(),

      identityService

    });


  /* ===== MEMORY ===== */

  const memoryRepository =
    new InMemoryMemoryRepository();


  const memoryService =
    new MemoryService({

      memoryRepository

    });


  /* ===== DEVICE ===== */

  const light =
    options.light ??
    new MockLight(
      "light-777"
    );


  /* ===== INTELLIGENCE ===== */

  const intelligenceEngine =
    new MockIntelligenceEngine(
      new OpenRouterIntelligenceProvider()
    );


  /* ===== CHAT ROUTES ===== */

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
        })

    }
  );


  /* ===== OTHER ROUTES ===== */

  app.register(
    conversationRoutes,
    {

      conversationService,

      identityService

    }
  );


  app.register(
    healthRoutes
  );

  app.register(imageGenerationRoutes);

  app.register(globalOrderRoutes);


  app.register(
    adminRoutes
  );


  app.register(
    memoryRoutes,
    {
      memoryService
    }
  );


  /* ===== HOME ===== */

  app.get(
    "/",
    async (_request, reply) => {

      // Serve the maintained public homepage first; keep the older graphic page only as fallback.
      const homePath = path.join(__dirname, "../public/index.html");
      const fallbackPath = path.join(__dirname, "../public/hormoz-graphic.html");
      let homeHtml: string;
      try {
        homeHtml = await fs.readFile(homePath, "utf8");
      } catch {
        homeHtml = await fs.readFile(fallbackPath, "utf8");
      }

      return reply
        .type("text/html; charset=utf-8")
        .send(homeHtml);

    }
  );


  /* ===== CHAT PAGE ===== */

  app.get(
    "/chat",
    async (_request, reply) => {

      return reply
        .type(
          "text/html; charset=utf-8"
        )
        .send(page);

    }
  );


  /* ===== ADMIN PANEL ===== */

  app.get(
    "/AdminPanel.html",
    async (_request, reply) => {

      const filePath =
        path.join(
          process.cwd(),
          "public",
          "AdminPanel.html"
        );


      const html =
        await fs.readFile(
          filePath,
          "utf8"
        );


      return reply
        .type(
          "text/html; charset=utf-8"
        )
        .send(html);

    }
  );


  app.get(
    "/admin",
    async (_request, reply) => {

      return reply.redirect(
        "/AdminPanel.html"
      );

    }
  );


  return app;
}