import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import fs from "node:fs/promises";
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
import { adminRoutes, recordPublicVisit } from "./routes/admin.js";

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
    src="/hormoz-music.mp3"
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
      />

<button
  class="send"
  id="sendButton"
  type="button"
  
>
  ارسال
</button>
    </div>

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

</footer>


<script>

/* =========================================================
   HORMOZ FRONTEND
   نسخه مقاوم در برابر خطاهای JavaScript
   ========================================================= */

const API = "/api/v1/chat";


/* =========================================================
   ELEMENTS
   ========================================================= */
const input =
  document.getElementById("message");
const sendButton =
  document.getElementById("sendButton");

const messages =
  document.getElementById("messages");


/* =========================================================
   HELPER
   ========================================================= */

function getResponseText(data) {

  if (!data) {
    return "";
  }

  return (
    data.content ||
    data.response ||
    data.reply ||
    data.message ||
    data.answer ||
    ""
  );
}


async function readJsonResponse(response) {

  const raw =
    await response.text();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "پاسخ نامعتبر از سرور دریافت شد."
    );
  }
}


/* =========================================================
   MUSIC
   ========================================================= */

const music =
  document.getElementById(
    "backgroundMusic"
  );

const musicButton =
  document.getElementById(
    "musicButton"
  );

let musicOn = false;


if (
  music &&
  musicButton
) {

  musicButton.addEventListener(
    "click",
    async () => {

      try {

        if (!musicOn) {

          await music.play();

          musicOn = true;

          musicButton.textContent =
            "🔇 توقف موسیقی";

        } else {

          music.pause();

          musicOn = false;

          musicButton.textContent =
            "🎵 موسیقی";

        }

      } catch (error) {

        console.error(
          "Music playback failed:",
          error
        );

        musicOn = false;

        musicButton.textContent =
          "🎵 پخش موسیقی";

      }

    }
  );

}


/* =========================================================
   ADMIN REQUEST
   ========================================================= */

async function sendAdminRequest() {

  const adminInput =
    document.getElementById(
      "adminRequest"
    );

  const result =
    document.getElementById(
      "adminResult"
    );

  const button =
    document.getElementById(
      "adminRequestButton"
    );


  if (
    !adminInput ||
    !result
  ) {

    return;

  }


  const message =
    adminInput.value.trim();


  if (!message) {

    result.textContent =
      "لطفاً موضوع درخواست را بنویسید.";

    return;

  }


  result.textContent =
    "⏳ نوا در حال آماده‌سازی درخواست است...";


  if (button) {
    button.disabled = true;
  }


  try {

    const response =
      await fetch(
        API,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-user-id":
              "public"
          },

          body:
            JSON.stringify({
              message:
                "درخواست اداری کاربر را به یک متن رسمی، محترمانه و آماده استفاده تبدیل کن:\n\n" +
                message
            })
        }
      );


    const data =
      await readJsonResponse(
        response
      );


    if (!response.ok) {

      throw new Error(
        data?.message ||
        data?.error ||
        "خطا در ارتباط با نوا"
      );

    }


    const answer =
      getResponseText(data);


    result.textContent =
      answer ||
      "نوا پاسخی دریافت نکرد.";


  } catch (error) {

    console.error(
      "Admin request failed:",
      error
    );

    result.textContent =
      "❌ فعلاً ارتباط با نوا برقرار نشد.";

  } finally {

    if (button) {
      button.disabled = false;
    }

  }

}


/*
   تابع را به window می‌دهیم تا
   اگر جایی onclick قدیمی وجود داشت
   باز هم کار کند.
*/

window.sendAdminRequest =
  sendAdminRequest;

const adminButton =
  document.getElementById(
    "adminRequestButton"
  );

if (adminButton) {
  adminButton.addEventListener(
    "click",
    sendAdminRequest
  );
}
/* =========================================================
   CHAT
   ========================================================= */

function addMessage(
  text,
  type
) {

  if (!messages) {
    return;
  }


  const div =
    document.createElement(
      "div"
    );


  div.className =
    "message " + type;


  div.textContent =
    text;


  messages.appendChild(
    div
  );


  messages.scrollTop =
    messages.scrollHeight;

}


async function sendMessage() {

  if (
    !input ||
    !sendButton ||
    !messages
  ) {

    return;

  }


  const message =
    input.value.trim();


  if (!message) {
    return;
  }


  addMessage(
    message,
    "user"
  );


  input.value = "";

  sendButton.disabled = true;

  try {

    const response =
      await fetch(
        API,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-user-id":
              "public"
          },

                    body:
            JSON.stringify({
              message
            })
          
        }
      );

    const data =
      await readJsonResponse(
        response
      );


    if (!response.ok) {

      throw new Error(
        data?.message ||
        data?.error ||
        "خطا در ارتباط با نوا"
      );

    }


    const answer =
      getResponseText(data);


    addMessage(
      answer ||
      "نوا پاسخی دریافت نکرد.",
      "nava"
    );


  } catch (error) {

    console.error(
      "Nava chat failed:",
      error
    );


    const detail =
      error instanceof Error
        ? error.message
        : "خطای نامشخص";


    addMessage(
      "❌ نوا فعلاً پاسخ نداد.\n" +
      detail,
      "nava"
    );


  } finally {

    sendButton.disabled =
      false;

    input.focus();

  }

}


/* =========================================================
   CHAT EVENTS
   ========================================================= */

if (
  sendButton &&
  input
) {

  sendButton.addEventListener(
    "click",
    sendMessage
  );


  input.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        sendMessage();

      }

    }
  );

}


/* =========================================================
   FEEDBACK
   ========================================================= */

const feedbackButton =
  document.getElementById(
    "sendFeedback"
  );

const feedbackMessage =
  document.getElementById(
    "feedbackMessage"
  );


if (
  feedbackButton &&
  feedbackMessage
) {

  feedbackButton.addEventListener(
    "click",
    async () => {

      const experience =
        document.querySelector(
          'input[name="fb1"]:checked'
        )?.value || "";


      const help =
        document.querySelector(
          'input[name="fb2"]:checked'
        )?.value || "";


      const returnUse =
        document.querySelector(
          'input[name="fb3"]:checked'
        )?.value || "";


      const likedInput =
        document.getElementById(
          "fb4"
        );


      const suggestionInput =
        document.getElementById(
          "fb5"
        );


      const likedOrImprove =
        likedInput
          ? likedInput.value.trim()
          : "";


      const suggestion =
        suggestionInput
          ? suggestionInput.value.trim()
          : "";


      if (
        !experience &&
        !help &&
        !returnUse &&
        !likedOrImprove &&
        !suggestion
      ) {

        feedbackMessage.textContent =
          "لطفاً حداقل یک مورد را وارد کنید.";

        return;

      }


      feedbackButton.disabled =
        true;


      feedbackButton.textContent =
        "در حال ارسال...";


      try {

        const response =
          await fetch(
            "/api/v1/feedback",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  experience,
                  help,
                  returnUse,
                  likedOrImprove,
                  suggestion
                })
            }
          );


        const data =
          await readJsonResponse(
            response
          );


        if (!response.ok) {

          throw new Error(
            data?.message ||
            data?.error ||
            "ثبت بازخورد ناموفق بود."
          );

        }


        feedbackMessage.textContent =
          "🙏 ممنون؛ بازخورد شما با موفقیت ثبت شد.";


        feedbackButton.textContent =
          "بازخورد ثبت شد ✓";


        document
          .querySelectorAll(
            'input[name="fb1"], input[name="fb2"], input[name="fb3"]'
          )
          .forEach(
            (item) => {

              item.checked =
                false;

            }
          );


        if (likedInput) {
          likedInput.value = "";
        }


        if (suggestionInput) {
          suggestionInput.value = "";
        }


      } catch (error) {

        console.error(
          "Feedback failed:",
          error
        );


        feedbackMessage.textContent =
          "❌ " +
          (
            error instanceof Error
              ? error.message
              : "خطا در ثبت بازخورد"
          );


        feedbackButton.disabled =
          false;


        feedbackButton.textContent =
          "ارسال بازخورد";

      }

    }
  );

}

</script>

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
          15 * 1024 * 1024,

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


  /* ===== MUSIC ===== */

  app.get(
    "/hormoz-music.mp3",
    async (_request, reply) => {

      const filePath =
        path.join(
          __dirname,
          "../public/بالاخره شد_۰۴۱۰۲۰۲۶.mp3"
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

      return reply
        .type(
          "text/html; charset=utf-8"
        )
        .send(page);

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