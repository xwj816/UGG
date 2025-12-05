// 產生 4 碼房間代碼（A-Z）
function generateInviteCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

/**
 * localStorage 裡維持一個 userId，跟 login.js 一樣邏輯
 */
const LOCAL_USER_ID_KEY = "pictionary_user_id";

function getOrCreateUserId() {
  let id = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (!id) {
    id = String(Math.floor(Math.random() * 100000)); // 0~99999
    localStorage.setItem(LOCAL_USER_ID_KEY, id);
  }
  return id;
}

// ---------------- 複製代碼：Clipboard API + fallback ----------------

function fallbackCopyTextToClipboard(text, buttonEl) {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
    if (ok) {
      buttonEl.innerHTML = "✅ 已複製!";
    } else {
      alert("複製失敗！瀏覽器不支援此操作。");
    }
  } catch (err) {
    alert("複製失敗！發生錯誤。");
  }

  document.body.removeChild(textArea);

  if (ok) {
    setTimeout(() => {
      buttonEl.innerHTML = "📋 複製代碼";
    }, 1500);
  }
}

function copyCode() {
  const code = document.getElementById("inviteCodeDisplay").textContent.trim();
  const copyButton = document.getElementById("copyButton");
  if (!code || code === "----") return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        copyButton.innerHTML = "✅ 已複製!";
        setTimeout(() => {
          copyButton.innerHTML = "📋 複製代碼";
        }, 1500);
      })
      .catch(() => {
        fallbackCopyTextToClipboard(code, copyButton);
      });
  } else {
    fallbackCopyTextToClipboard(code, copyButton);
  }
}

// ---------------- URL & Header ----------------

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    username: params.get("username"),
    roomID: params.get("roomID"),    // 如果從別處帶來已經有 roomID
    joinCode: params.get("joinCode") // 你之前用的參數名，當作備用
  };
}

function updateHeaderUsername(username) {
  const headerDisplay = document.getElementById("headerUsernameDisplay");
  if (headerDisplay) {
    headerDisplay.textContent = username || "訪客名稱載入中...";
  }
}

// ---------------- 初始化整個房間頁 ----------------

function initRoomPage() {
  const { username, roomID, joinCode } = getUrlParams();

  // 1. 決定 userId & 房間代碼
  const userId = getOrCreateUserId();
  // 如果網址上有 roomID 或 joinCode，就用那個，否則自己生成
  const initialCode = (roomID || joinCode || generateInviteCode()).toUpperCase();

  // 2. 更新 header 上的名稱
  updateHeaderUsername(username);

  // 3. 抓 DOM 元素
  const codeElement = document.getElementById("inviteCodeDisplay");
  const copyButton = document.getElementById("copyButton");
  const joinUsernameInput = document.getElementById("joinUsername");
  const joinUserIdInput = document.getElementById("joinUserId");
  const joinCodeInput = document.getElementById("joinCode");
  const joinForm = document.getElementById("joinForm");

  // 4. 顯示房間代碼、帶到輸入框
  if (codeElement) {
    codeElement.textContent = initialCode;
  }
  if (joinCodeInput) {
    joinCodeInput.value = initialCode;
  }

  // 5. 隱藏欄位：username / userId
  if (joinUsernameInput) {
    joinUsernameInput.value = username || "";
  }
  if (joinUserIdInput) {
    joinUserIdInput.value = userId;
  }

  // 6. 複製按鈕
  if (copyButton) {
    copyButton.addEventListener("click", copyCode);
  }

  // 7. 攔截「加入房間」表單：組出正確的 lobby URL
  if (joinForm) {
    joinForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const codeValue = (joinCodeInput.value || "").trim().toUpperCase();
      const finalName = joinUsernameInput.value || "Guest";
      const finalUserId = joinUserIdInput.value || getOrCreateUserId();

      if (!codeValue) {
        alert("請輸入房間代碼！");
        return;
      }

      const targetURL =
        `../lobby/lobby.html` +
        `?username=${encodeURIComponent(finalName)}` +
        `&roomID=${encodeURIComponent(codeValue)}` +
        `&userId=${encodeURIComponent(finalUserId)}`;

      window.location.href = targetURL;
    });
  }
}

document.addEventListener("DOMContentLoaded", initRoomPage);
