/**
 * 隨機生成一個訪客風格的用戶名 (例如：Player_1234)
 * @returns {string}
 */
function generateRandomUsername() {
  const prefix = ["Guest", "Player", "Drawer", "Thinker", "Artist"];
  const number = Math.floor(Math.random() * 9000) + 1000;
  const randomPrefix = prefix[Math.floor(Math.random() * prefix.length)];

  return randomPrefix + "_" + number;
}

/**
 * 隨機生成一個 4 位房間 ID (字母和數字混合)
 * @returns {string}
 */
function generateRandomRoomID() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

/**
 * 取得 / 建立一個 userId，保存在 localStorage
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

/**
 * 獲取 URL 參數
 */
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    username: params.get("username"),
    roomID: params.get("roomID"),
  };
}
// login/login.js (修正 handleQuickPlay 函式)

// ... (其他函數保持不變) ...

/**
 * 處理「遊玩!」按鈕的提交事件，生成隨機房間 ID 並跳轉到遊戲頁。
 */
function handleQuickPlay(event) {
    event.preventDefault(); 

    const inputElement = document.getElementById('inputUsername');
    const username = inputElement.value;
    
    if (!username || username.trim() === '') {
        alert('請輸入或讓系統生成一個名稱！');
        return;
    }
    
    const roomID = generateRandomRoomID();
    // 🎯 修正點 1: 跳轉到 index/index.html，並確保參數名為 roomId
    const targetURL = `../index/index.html?username=${encodeURIComponent(username)}&roomId=${roomID}`;
    
    window.location.href = targetURL;
}

// ... (其他函數保持不變) ...
/**
 * 「遊玩」按鈕的提交事件
 * 產生 / 使用房間 ID，並帶著 username & roomID & userId 跳到 lobby
 */
function handleQuickPlay(event) {
  event.preventDefault(); // 自己控制跳轉，不用真的提交表單

  const inputElement = document.getElementById("inputUsername");
  const username = inputElement.value;

  if (!username || username.trim() === "") {
    alert("請輸入或讓系統生成一個名稱！");
    return;
  }

  const { roomID: urlRoomID } = getUrlParams();
  const roomID = urlRoomID || generateRandomRoomID(); // 若網址已有房號，就沿用
  const userId = getOrCreateUserId();

  // 跳到 lobby.html，帶上所有需要的資訊
  const targetURL =
    `../lobby/lobby.html` +
    `?username=${encodeURIComponent(username)}` +
    `&roomID=${encodeURIComponent(roomID)}` +
    `&userId=${encodeURIComponent(userId)}`;

  window.location.href = targetURL;
}

/**
 * 頁面載入時設定初始用戶名並添加所有事件監聽。
 */
function setInitialUsername() {
  const displayElement = document.getElementById("displayUsername");
  const inputElement = document.getElementById("inputUsername");
  const roomButton = document.querySelector(".room-button");
  const loginForm = document.getElementById("loginForm");

  // 取得網址上的初始 username / roomID（如果有人分享連結）
  const { username: urlUsername, roomID: urlRoomID } = getUrlParams();

  // 1. 使用網址上的 username，如果沒有就隨機一個
  let initialName = urlUsername;
  if (!initialName) {
    initialName = generateRandomUsername();
  }

  // 顯示到右上角 & 輸入框
  if (displayElement) {
    displayElement.textContent = initialName;
  }
  if (inputElement) {
    inputElement.value = initialName;
  }

  // 2. 房間按鈕：把目前輸入的 username 帶到 room.html
  if (roomButton && inputElement) {
    const currentHrefBase = roomButton.getAttribute("href").split("?")[0];

    // 頁面載入時，先帶 initialName
    roomButton.setAttribute(
      "href",
      `${currentHrefBase}?username=${encodeURIComponent(initialName)}`
    );

    // 輸入框變更時，同步更新顯示＆連結
    inputElement.addEventListener("input", function () {
      const name = this.value || "訪客名稱";

      if (displayElement) {
        displayElement.textContent = name;
      }

      roomButton.setAttribute(
        "href",
        `${currentHrefBase}?username=${encodeURIComponent(this.value)}`
      );
    });
  }

  // 3. 「遊玩」按鈕：監聽表單提交
  if (loginForm) {
    loginForm.addEventListener("submit", handleQuickPlay);
  }

  // 如果網址本來就有 roomID，也可以在畫面上提示玩家
  if (urlRoomID) {
    console.log("從網址接收到 roomID：", urlRoomID, "（朋友分享的房間）");
  }
}

// 當頁面完全載入時，執行設定用戶名和事件監聽
document.addEventListener("DOMContentLoaded", setInitialUsername);
