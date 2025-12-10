function generateRandomUsername() {
  const prefix = ["Guest", "Player", "Drawer", "Thinker", "Artist"];
  const number = Math.floor(Math.random() * 9000) + 1000;
  const randomPrefix = prefix[Math.floor(Math.random() * prefix.length)];
  return randomPrefix + "_" + number;
}

function generateRandomRoomID() {
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
  };
}

function handleQuickPlay(event) {
  event.preventDefault();

  const inputElement = document.getElementById("inputUsername");
  const username = inputElement.value;

  if (!username || username.trim() === "") {
    alert("請輸入或讓系統生成一個名稱！");
    return;
  }

  const { roomID: urlRoomID } = getUrlParams();
  const roomID = urlRoomID || generateRandomRoomID();
  const userId = getOrCreateUserId();

  const targetURL =
    `../lobby/lobby.html` +
    `?username=${encodeURIComponent(username)}` +
    `&roomID=${encodeURIComponent(roomID)}` +
    `&userId=${encodeURIComponent(userId)}`;

  window.location.href = targetURL;
}

function setInitialUsername() {
  const displayElement = document.getElementById("displayUsername");
  const inputElement = document.getElementById("inputUsername");
  const roomButton = document.querySelector(".room-button");
  const loginForm = document.getElementById("loginForm");

  const { username: urlUsername, roomID: urlRoomID } = getUrlParams();

  let initialName = urlUsername || generateRandomUsername();

  if (displayElement) displayElement.textContent = initialName;
  if (inputElement) inputElement.value = initialName;

  if (roomButton && inputElement) {
    const updateRoomLink = (name) => {
      const currentHrefBase = roomButton.getAttribute("href").split("?")[0];
      roomButton.setAttribute(
        "href",
        `${currentHrefBase}?username=${encodeURIComponent(name)}`
      );
      if (displayElement) displayElement.textContent = name;
    };

    updateRoomLink(initialName);

    inputElement.addEventListener("input", function () {
      updateRoomLink(this.value || "訪客");
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", handleQuickPlay);
  }

  if (urlRoomID) {
    console.log("偵測到房間 ID：", urlRoomID);
  }
}

document.addEventListener("DOMContentLoaded", setInitialUsername);