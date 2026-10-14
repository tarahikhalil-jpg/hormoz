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

function addMessage(text, type) {
  if (!messages) return;

  const div = document.createElement("div");

  div.className = "message " + type;
  div.textContent = text;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
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

    addMessage(
      answer || "نوا پاسخی دریافت نکرد.",
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
