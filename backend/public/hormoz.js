const API = window.location.origin + "/api/v1/chat";

const input = document.getElementById("message");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

function getResponseText(data) {
  if (!data) return "";

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
  const raw = await response.text();

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("پاسخ نامعتبر از سرور دریافت شد.");
  }
}

/* MUSIC */

const music = document.getElementById("backgroundMusic");
const musicButton = document.getElementById("musicButton");

let musicOn = false;

if (music && musicButton) {
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
      console.error("Music playback failed:", error);
      musicOn = false;
      musicButton.textContent = "🎵 پخش موسیقی";
    }
  });
}

/* CHAT */

function makeLetterActionButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.style.cssText = "padding:9px 12px;font-size:13px;border-radius:10px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.22);cursor:pointer;";
  return button;
}

function addLetterActions(messageElement, text) {
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;";

  const copyButton = makeLetterActionButton("📋 کپی نامه", "کپی متن");
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "✅ کپی شد";
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      copyButton.textContent = copied ? "✅ کپی شد" : "متن را انتخاب و کپی کنید";
    }
  });

  const emailButton = makeLetterActionButton("✉️ ارسال با ایمیل", "باز کردن برنامه ایمیل گوشی");
  emailButton.addEventListener("click", () => {
    const subject = "نامه از هوش هرمز";
    const mailto = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(text);
    window.location.href = mailto;
  });

  const shareButton = makeLetterActionButton("📤 اشتراک‌گذاری", "ارسال با برنامه‌های گوشی");
  shareButton.addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "نامه از هوش هرمز", text });
      } catch (error) {
        if (error && error.name !== "AbortError") {
          console.error("Sharing failed:", error);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        shareButton.textContent = "✅ کپی شد؛ در برنامه دلخواه بچسبانید";
      } catch {
        alert("لطفاً متن نامه را کپی کنید و در برنامه دلخواه خود قرار دهید.");
      }
    }
  });

  const pdfButton = makeLetterActionButton("📄 چاپ / ذخیره PDF", "باز کردن نسخه آماده چاپ؛ در پنجره چاپ گزینه ذخیره به PDF را انتخاب کنید");
  pdfButton.addEventListener("click", () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("مرورگر پنجره جدید را مسدود کرده است. اجازه باز شدن پنجره را بدهید و دوباره بزنید.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(
      "<!doctype html><html lang='fa' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>نامه از هوش هرمز</title><style>body{font-family:Tahoma,Arial,sans-serif;max-width:800px;margin:40px auto;padding:24px;color:#111;line-height:2.2;white-space:pre-wrap;font-size:16px}h1{font-size:20px;border-bottom:1px solid #ccc;padding-bottom:12px}@media print{body{margin:0 auto;padding:12mm}}</style></head><body><h1>نامه</h1><div id='letter'></div><script>document.getElementById('letter').textContent=" + JSON.stringify(text) + ";window.onload=()=>setTimeout(()=>window.print(),250);<\/script></body></html>"
    );
    printWindow.document.close();
  });

  actions.append(copyButton, emailButton, shareButton, pdfButton);
  messageElement.appendChild(actions);
}

function addMessage(text, type) {
  if (!messages) return;

  const div = document.createElement("div");
  div.className = "message " + type;

  const content = document.createElement("div");
  content.textContent = text;
  div.appendChild(content);

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

/* VOICE CHAT: browser speech recognition + speech synthesis */
const speechButton = document.getElementById("speechButton");
const voiceReplyButton = document.getElementById("voiceReplyButton");
const voiceStatus = document.getElementById("voiceStatus");
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let voiceReplyEnabled = true;

function setVoiceStatus(message) {
  if (voiceStatus) voiceStatus.textContent = message;
}

function speakNava(text) {
  if (!voiceReplyEnabled || !("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fa-IR";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const persianVoice = voices.find((voice) => /^fa([_-]|$)/i.test(voice.lang));
    if (persianVoice) utterance.voice = persianVoice;
    utterance.onerror = () => setVoiceStatus("پاسخ متنی آماده است؛ خواندن صوتی در این گوشی در دسترس نیست.");
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error("Nava speech output failed:", error);
    setVoiceStatus("پاسخ متنی آماده است؛ صدای فارسی در این مرورگر پشتیبانی نشد.");
  }
}

if (voiceReplyButton) {
  voiceReplyButton.addEventListener("click", () => {
    voiceReplyEnabled = !voiceReplyEnabled;
    voiceReplyButton.setAttribute("aria-pressed", String(voiceReplyEnabled));
    voiceReplyButton.textContent = voiceReplyEnabled ? "🔊 پاسخ صوتی: روشن" : "🔇 پاسخ صوتی: خاموش";
    if (!voiceReplyEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setVoiceStatus(voiceReplyEnabled ? "پاسخ‌های نوا پس از دریافت، با صدا خوانده می‌شوند." : "پاسخ صوتی خاموش شد؛ پاسخ‌ها به‌صورت متن نمایش داده می‌شوند.");
  });
}

if (speechButton) {
  if (!SpeechRecognitionAPI) {
    speechButton.disabled = true;
    speechButton.textContent = "🎙️ گفتار در این مرورگر پشتیبانی نمی‌شود";
    speechButton.style.opacity = "0.65";
    setVoiceStatus("تشخیص گفتار در این مرورگر در دسترس نیست. در صورت امکان صفحه را با Chrome به‌روز باز کن؛ تایپ با میکروفون صفحه‌کلید هم می‌تواند کمک کند.");
  } else {
    recognition = new SpeechRecognitionAPI();
    recognition.lang = "fa-IR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      speechButton.setAttribute("aria-pressed", "true");
      speechButton.textContent = "🛑 پایان صحبت";
      setVoiceStatus("نوا گوش می‌دهد… حالا نیازت را به فارسی بگو.");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || [])
        .map((result) => result[0] && result[0].transcript ? result[0].transcript : "")
        .join(" ")
        .trim();
      if (!transcript) {
        setVoiceStatus("صدایی به متن تبدیل نشد؛ دوباره امتحان کن.");
        return;
      }
      if (input) input.value = transcript;
      setVoiceStatus("شنیدم: «" + transcript + "» — در حال فرستادن برای نوا…");
      sendMessage();
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "اجازه میکروفون داده نشد. مجوز میکروفون سایت را در تنظیمات مرورگر بررسی کن.",
        "service-not-allowed": "سرویس تشخیص گفتار در این مرورگر یا شبکه در دسترس نیست.",
        "no-speech": "صدایی نشنیدم؛ دوباره دکمه را بزن و نزدیک‌تر صحبت کن.",
        "network": "تشخیص گفتار به اتصال شبکه نیاز دارد و فعلاً برقرار نشد.",
        "audio-capture": "میکروفون پیدا نشد یا برنامه دیگری از آن استفاده می‌کند."
      };
      setVoiceStatus(messages[event.error] || "تشخیص صدا ناموفق بود. دوباره امتحان کن یا از میکروفون صفحه‌کلید استفاده کن.");
    };

    recognition.onend = () => {
      listening = false;
      speechButton.setAttribute("aria-pressed", "false");
      speechButton.textContent = "🎙️ صحبت با نوا";
    };

    speechButton.addEventListener("click", () => {
      if (listening) {
        recognition.stop();
        return;
      }
      try {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        recognition.start();
      } catch (error) {
        console.error("Nava speech recognition failed:", error);
        setVoiceStatus("شروع میکروفون ممکن نشد؛ چند لحظه صبر کن و دوباره بزن.");
      }
    });
  }
}

async function sendMessage() {
  if (!input || !sendButton || !messages) {
    return;
  }

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

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        "خطا در ارتباط با نوا"
      );
    }

    const answer = getResponseText(data);

    const spokenAnswer = answer || "نوا پاسخی دریافت نکرد.";
    addMessage(spokenAnswer, "nava");
    speakNava(spokenAnswer);
    if (voiceReplyEnabled) {
      setVoiceStatus("پاسخ نوا آماده شد؛ اگر صدای فارسی گوشی پشتیبانی شود، پاسخ خوانده می‌شود.");
    }

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
      "❌ نوا فعلاً پاسخ نداد.\n" + detail,
      "nava"
    );

  } finally {

    sendButton.disabled = false;
    input.focus();

  }
}

window.sendMessage = sendMessage;

if (sendButton && input) {

  sendButton.addEventListener(
    "click",
    sendMessage
  );

  input.addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }

    }
  );
}

/* FEEDBACK */

const feedbackButton =
  document.getElementById("sendFeedback");

const feedbackMessage =
  document.getElementById("feedbackMessage");

if (feedbackButton && feedbackMessage) {

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
        document.getElementById("fb4");

      const suggestionInput =
        document.getElementById("fb5");

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

      feedbackButton.disabled = true;
      feedbackButton.textContent = "در حال ارسال...";

      try {

        const response = await fetch(
          "/api/v1/feedback",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              experience,
              help,
              returnUse,
              likedOrImprove,
              suggestion
            })
          }
        );

        const data =
          await readJsonResponse(response);

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
          .forEach((item) => {
            item.checked = false;
          });

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

        feedbackButton.disabled = false;
        feedbackButton.textContent =
          "ارسال بازخورد";
      }
    }
  );
}

/* ADMIN WRITING ASSISTANT */
const adminRequestInput = document.getElementById("adminRequest");
const adminRequestButton = document.getElementById("adminRequestButton");
const adminResult = document.getElementById("adminResult");

if (adminRequestInput && adminRequestButton && adminResult) {
  adminRequestButton.addEventListener("click", async () => {
    const requestText = adminRequestInput.value.trim();
    if (!requestText) {
      adminResult.textContent = "لطفاً موضوع درخواست را بنویسید.";
      return;
    }

    adminRequestButton.disabled = true;
    adminRequestButton.textContent = "در حال آماده‌سازی...";
    adminResult.textContent = "نوا در حال آماده‌سازی متن است...";

    try {
      const response = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "public"
        },
        body: JSON.stringify({
          message: "لطفاً بر اساس توضیح زیر یک متن رسمی، روشن و محترمانه به زبان فارسی آماده کن. اگر اطلاعات ضروری کم است، جای خالی مشخص کن و هیچ واقعیتی را جعل نکن. موضوع درخواست: " + requestText
        })
      });

      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.message || data?.error || "نوا نتوانست متن را آماده کند.");
      }

      const answer = getResponseText(data);
      adminResult.textContent = answer || "پاسخ قابل استفاده‌ای دریافت نشد؛ لطفاً دوباره تلاش کنید.";
      adminResult.style.whiteSpace = "pre-wrap";

      // Letter actions belong to the request-letter area, not ordinary Nava chat.
      if (answer) {
        addLetterActions(adminResult, answer);
      }
    } catch (error) {
      adminResult.textContent = "خطا: " + (error instanceof Error ? error.message : "ارتباط با نوا برقرار نشد.");
    } finally {
      adminRequestButton.disabled = false;
      adminRequestButton.textContent = "✍️ آماده‌سازی درخواست";
    }
  });
}

/* PWA: REGISTER SERVICE WORKER AND OFFER INSTALL */
let hormozInstallPrompt = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Hormoz service worker registration failed:", error);
    });
  });
}

if (!document.querySelector('link[rel="manifest"]')) {
  const manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = "/manifest.json";
  document.head.appendChild(manifestLink);
}

const installButton = document.createElement("button");
installButton.type = "button";
installButton.textContent = "📲 نصب هرمز روی گوشی";
installButton.setAttribute("aria-label", "نصب اپلیکیشن هرمز روی گوشی");
installButton.style.cssText = "margin-top:10px;background:#f2ce79;color:#10251f;border:0;border-radius:14px;padding:13px 18px;font:inherit;font-weight:bold;cursor:pointer;";
const heroButtons = document.querySelector(".hero .buttons");
if (heroButtons) {
  heroButtons.appendChild(installButton);
  installButton.addEventListener("click", async () => {
    if (hormozInstallPrompt) {
      hormozInstallPrompt.prompt();
      await hormozInstallPrompt.userChoice;
      hormozInstallPrompt = null;
    } else {
      alert("برای نصب هرمز: منوی مرورگر را باز کنید و گزینه «افزودن به صفحه اصلی» یا «نصب برنامه» را انتخاب کنید.");
    }
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  hormozInstallPrompt = event;
});

/* MAKE SERVICE AND INCOME SECTIONS ACTIONABLE */
function addOrdersAction(headingText, label) {
  const heading = Array.from(document.querySelectorAll("h2")).find((item) =>
    item.textContent && item.textContent.includes(headingText)
  );
  const box = heading?.closest(".project-box");
  if (!box || box.querySelector("[data-hormoz-orders-action]")) return;

  const link = document.createElement("a");
  link.href = "/orders.html";
  link.textContent = label;
  link.setAttribute("data-hormoz-orders-action", "true");
  link.className = "chat-button";
  link.style.cssText = "display:inline-block;margin-top:18px;text-decoration:none;background:#f2ce79;color:#10251f;border-radius:14px;padding:13px 20px;font-weight:bold;";
  box.appendChild(link);
}

addOrdersAction("خدمات هرمز", "ثبت درخواست خدمات و همکاری");
addOrdersAction("مسیر درآمد هرمز", "معرفی اثر، مهارت یا پیشنهاد همکاری");
