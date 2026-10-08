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