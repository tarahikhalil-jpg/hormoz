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

  if (type === "nava") {
    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.textContent = "🔊 شنیدن پاسخ نوا";
    speakButton.style.cssText = "margin-top:10px;padding:9px 12px;font-size:13px;border-radius:10px;background:rgba(255,255,255,.12);color:inherit;border:1px solid rgba(255,255,255,.3);cursor:pointer;";
    speakButton.addEventListener("click", () => {
      // Let speakNava choose browser speech or its online Persian-audio fallback.
      // Do not block fallback audio just because SpeechSynthesis is unavailable.
      voiceReplyEnabled = true;
      if (voiceReplyButton) {
        voiceReplyButton.setAttribute("aria-pressed", "true");
        voiceReplyButton.textContent = "🔊 پاسخ صوتی: روشن";
      }
      speakButton.textContent = "🔊 در حال پخش…";
      speakNava(text, () => {
        speakButton.textContent = "🔊 شنیدن دوباره پاسخ";
      });
    });
    div.appendChild(speakButton);
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

/* VOICE CHAT: hands-free turn-taking using browser speech recognition and speech synthesis */
const speechButton = document.getElementById("speechButton");
const voiceReplyButton = document.getElementById("voiceReplyButton");
const voiceStatus = document.getElementById("voiceStatus");
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let voiceSessionActive = false;
let voiceBusy = false;
let speaking = false;
let voiceRestartTimer = null;
let voiceReplyEnabled = true;

function setVoiceStatus(message) {
  if (voiceStatus) voiceStatus.textContent = message;
}

function updateVoiceButton() {
  if (!speechButton) return;
  speechButton.setAttribute("aria-pressed", String(voiceSessionActive));
  speechButton.textContent = voiceSessionActive
    ? "🛑 پایان مکالمه صوتی"
    : "🎙️ شروع مکالمه صوتی پیوسته";
}

function resumeVoiceListening() {
  if (!voiceSessionActive || !recognition || voiceBusy || speaking) return;
  clearTimeout(voiceRestartTimer);
  voiceRestartTimer = setTimeout(() => {
    if (!voiceSessionActive || voiceBusy || speaking || listening) return;
    try {
      recognition.start();
    } catch (error) {
      console.warn("Voice recognition restart deferred:", error);
      clearTimeout(voiceRestartTimer);
      voiceRestartTimer = setTimeout(resumeVoiceListening, 700);
    }
  }, 450);
}

function speakNava(text, onDone) {
  if (!text) {
    if (typeof onDone === "function") onDone();
    return;
  }

  const cleaned = String(text).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    if (typeof onDone === "function") onDone();
    return;
  }

  let finished = false;
  let browserStarted = false;
  let watchdog = null;
  let index = 0;
  let fallbackAudio = null;
  const chunks = [];
  let remaining = cleaned;
  while (remaining.length) {
    if (remaining.length <= 170) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf(" ", 170);
    if (cut < 70) cut = 170;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  const finish = (message) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    speaking = false;
    if (message) setVoiceStatus(message);
    if (typeof onDone === "function") onDone();
  };

  // Fallback audio does not depend on the phone's installed speech engine.
  const playOnlinePersianAudio = () => {
    if (finished) return;
    if (fallbackAudio) {
      try { fallbackAudio.pause(); } catch (_) {}
    }
    fallbackAudio = new Audio();
    fallbackAudio.preload = "auto";
    let audioIndex = 0;
    const playNextAudioChunk = () => {
      if (finished) return;
      if (audioIndex >= chunks.length) {
        finish("پاسخ صوتی نوا پخش شد.");
        return;
      }
      const params = new URLSearchParams({
        ie: "UTF-8",
        q: chunks[audioIndex++],
        tl: "fa",
        client: "tw-ob"
      });
      fallbackAudio.src = "https://translate.google.com/translate_tts?" + params.toString();
      fallbackAudio.onended = playNextAudioChunk;
      fallbackAudio.onerror = () => finish("صدای آنلاین نوا هم در این اتصال در دسترس نیست؛ پاسخ متنی آماده است.");
      const playPromise = fallbackAudio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          console.warn("Nava online audio fallback failed:", error);
          finish("پخش صوتی مسدود شد؛ پاسخ متنی آماده است. یک بار دیگر دکمه شنیدن را لمس کن.");
        });
      }
    };
    setVoiceStatus("موتور صدای گوشی شروع نشد؛ دارم صدای فارسی آنلاین نوا را امتحان می‌کنم…");
    playNextAudioChunk();
  };

  const synthAvailable = ("speechSynthesis" in window) && typeof SpeechSynthesisUtterance !== "undefined";
  if (!synthAvailable) {
    playOnlinePersianAudio();
    return;
  }

  const synth = window.speechSynthesis;
  const startNext = () => {
    if (finished) return;
    if (index >= chunks.length) {
      finish();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index++]);
    utterance.lang = "fa-IR";
    utterance.rate = 0.88;
    utterance.pitch = 1;
    const persianVoice = synth.getVoices().find((voice) => /^fa([_-]|$)/i.test(voice.lang));
    if (persianVoice) utterance.voice = persianVoice;

    utterance.onstart = () => {
      browserStarted = true;
      speaking = true;
      setVoiceStatus("نوا در حال خواندن پاسخ است…");
    };
    utterance.onend = () => {
      if (index < chunks.length) setTimeout(startNext, 100);
      else finish();
    };
    utterance.onerror = (event) => {
      console.warn("Nava speech output error:", event && event.error);
      if (!browserStarted) {
        try { synth.cancel(); } catch (_) {}
        playOnlinePersianAudio();
      } else {
        finish("خواندن پاسخ در مرورگر متوقف شد؛ دوباره «شنیدن پاسخ نوا» را بزن.");
      }
    };
    synth.speak(utterance);
  };

  try {
    setVoiceStatus("در حال آماده‌سازی صدای نوا…");
    if (synth.paused) synth.resume();
    startNext();
    watchdog = setTimeout(() => {
      if (!finished && !browserStarted) {
        try { synth.cancel(); } catch (_) {}
        speaking = false;
        playOnlinePersianAudio();
      }
    }, 2500);
  } catch (error) {
    console.error("Nava speech output failed:", error);
    playOnlinePersianAudio();
  }
}

if (voiceReplyButton) {
  voiceReplyButton.addEventListener("click", () => {
    voiceReplyEnabled = !voiceReplyEnabled;
    voiceReplyButton.setAttribute("aria-pressed", String(voiceReplyEnabled));
    voiceReplyButton.textContent = voiceReplyEnabled ? "🔊 پاسخ صوتی: روشن" : "🔇 پاسخ صوتی: خاموش";
    if (!voiceReplyEnabled && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speaking = false;
    }
    setVoiceStatus(voiceReplyEnabled
      ? "پاسخ‌های نوا با صدا خوانده می‌شوند."
      : "پاسخ صوتی خاموش شد؛ مکالمه صوتی می‌تواند ادامه یابد.");
  });
}

if (speechButton) {
  if (!SpeechRecognitionAPI) {
    speechButton.disabled = true;
    speechButton.textContent = "🎙️ گفتار در این مرورگر پشتیبانی نمی‌شود";
    speechButton.style.opacity = "0.65";
    setVoiceStatus("تشخیص گفتار در این مرورگر در دسترس نیست. در صورت امکان سایت را با Chrome به‌روز باز کن.");
  } else {
    recognition = new SpeechRecognitionAPI();
    recognition.lang = "fa-IR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      updateVoiceButton();
      setVoiceStatus("نوا گوش می‌دهد… به فارسی صحبت کن. پس از پاسخ، دوباره خودکار گوش می‌دهد.");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || [])
        .map((result) => result[0] && result[0].transcript ? result[0].transcript : "")
        .join(" ")
        .trim();
      if (!transcript) {
        setVoiceStatus("صدایی به متن تبدیل نشد؛ دوباره صحبت کن.");
        return;
      }
      voiceBusy = true;
      if (input) input.value = transcript;
      setVoiceStatus("شنیدم: «" + transcript + "» — نوا در حال پاسخ‌گویی است…");
      try { recognition.stop(); } catch {}
      sendMessage({ fromVoice: true });
    };

    recognition.onerror = (event) => {
      const errors = {
        "not-allowed": "اجازه میکروفون داده نشد؛ مجوز میکروفون سایت را در مرورگر فعال کن.",
        "service-not-allowed": "سرویس تشخیص گفتار در این مرورگر یا شبکه در دسترس نیست.",
        "no-speech": "صدایی نشنیدم؛ اگر مکالمه فعال باشد دوباره گوش می‌دهم.",
        "network": "سرویس تشخیص گفتار به شبکه نیاز دارد و فعلاً وصل نشد.",
        "audio-capture": "میکروفون پیدا نشد یا برنامه دیگری از آن استفاده می‌کند."
      };
      setVoiceStatus(errors[event.error] || "تشخیص صدا ناموفق بود.");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        voiceSessionActive = false;
        voiceBusy = false;
        updateVoiceButton();
      }
    };

    recognition.onend = () => {
      listening = false;
      if (voiceSessionActive && !voiceBusy && !speaking) {
        setVoiceStatus("نوا آماده شنیدن ادامه صحبت توست…");
        resumeVoiceListening();
      } else if (!voiceSessionActive) {
        updateVoiceButton();
      }
    };

    speechButton.addEventListener("click", () => {
      if (voiceSessionActive) {
        voiceSessionActive = false;
        voiceBusy = false;
        clearTimeout(voiceRestartTimer);
        try { recognition.stop(); } catch {}
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        speaking = false;
        updateVoiceButton();
        setVoiceStatus("مکالمه صوتی پایان یافت. هر وقت خواستی دوباره شروع کن.");
        return;
      }

      voiceSessionActive = true;
      voiceBusy = false;
      updateVoiceButton();
      try {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        recognition.start();
      } catch (error) {
        console.error("Nava speech recognition failed:", error);
        voiceSessionActive = false;
        updateVoiceButton();
        setVoiceStatus("شروع میکروفون ممکن نشد؛ چند لحظه صبر کن و دوباره بزن.");
      }
    });
  }
}

async function sendMessage(options = {}) {
  const fromVoice = options.fromVoice === true;
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
    if (fromVoice && voiceSessionActive) {
      speakNava(spokenAnswer, () => {
        voiceBusy = false;
        if (voiceSessionActive) {
          setVoiceStatus("نوا گوش می‌دهد… می‌توانی ادامه بدهی.");
          resumeVoiceListening();
        }
      });
    } else {
      speakNava(spokenAnswer);
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
    if (fromVoice && voiceSessionActive) {
      voiceBusy = false;
      setVoiceStatus("پاسخ از سرور دریافت نشد؛ دوباره صحبت کن یا اتصال را بررسی کن.");
      resumeVoiceListening();
    }

  } finally {

    sendButton.disabled = false;
    if (!fromVoice) input.focus();

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
