function generateInviteCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

const LOCAL_USER_ID_KEY = "pictionary_user_id";

function getOrCreateUserId() {
  let id = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (!id) {
    id = String(Math.floor(Math.random() * 100000));
    localStorage.setItem(LOCAL_USER_ID_KEY, id);
  }
  return id;
}

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    username: params.get("username"),
    roomID: params.get("roomID"),    
    joinCode: params.get("joinCode")
  };
}

function fallbackCopyTextToClipboard(text, buttonEl) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed"; 
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
    buttonEl.innerHTML = ok ? "✅ 已複製!" : "❌ 失敗";
  } catch (err) {
    console.error('Copy failed', err);
    buttonEl.innerHTML = "❌ 錯誤";
  }

  document.body.removeChild(textArea);

  if (ok) {
    setTimeout(() => { buttonEl.innerHTML = "📋 複製代碼"; }, 1500);
  }
}

function copyCode() {
  const code = document.getElementById("inviteCodeDisplay").textContent.trim();
  const copyButton = document.getElementById("copyButton");
  if (!code || code === "----") return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code)
      .then(() => {
        copyButton.innerHTML = "✅ 已複製!";
        setTimeout(() => { copyButton.innerHTML = "📋 複製代碼"; }, 1500);
      })
      .catch(() => fallbackCopyTextToClipboard(code, copyButton));
  } else {
    fallbackCopyTextToClipboard(code, copyButton);
  }
}

function initRoomPage() {
  const { username, roomID, joinCode } = getUrlParams();
  const userId = getOrCreateUserId();

  const displayCode = (roomID || joinCode || generateInviteCode()).toUpperCase();

  const headerDisplay = document.getElementById("headerUsernameDisplay");
  if (headerDisplay) {
    headerDisplay.textContent = username || "訪客";
  }

  const codeElement = document.getElementById("inviteCodeDisplay");
  const copyButton = document.getElementById("copyButton");
  const joinUsernameInput = document.getElementById("joinUsername");
  const joinUserIdInput = document.getElementById("joinUserId");
  const joinCodeInput = document.getElementById("joinCode");
  const joinForm = document.getElementById("joinForm");

  if (codeElement) codeElement.textContent = displayCode;
  
  if (joinCodeInput) {
    joinCodeInput.value = displayCode; 
    // 防止輸入數字
    joinCodeInput.addEventListener('input', function(e) {
      this.value = this.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
    });
  }

  if (joinUsernameInput) joinUsernameInput.value = username || "";
  if (joinUserIdInput) joinUserIdInput.value = userId;

  if (copyButton) {
    copyButton.addEventListener("click", copyCode);
  }

  if (joinForm) {
    joinForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const codeValue = (joinCodeInput.value || "").trim().toUpperCase();
      const finalName = joinUsernameInput.value || "Guest";
      const finalUserId = joinUserIdInput.value;

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