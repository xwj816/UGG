//你好呀
// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// 給前端用的靜態檔案（public/index.html）
app.use(express.static("public"));
app.get("/", (req, res) => {
  // 直接送出 index.html，而不是文字
  res.sendFile(__dirname + "/public/index.html");
});

/**
 * 資料結構：
 * rooms = {
 *   [roomId]: {
 *     players: {
 *       [socketId]: { userId, nickname, score }
 *     },
 *     order: [socketId1, socketId2, ...],  // 進房順序，拿來輪流當畫家
 *     drawerSocketId: string | null,       // 當前畫家的 socketId
 *     status: 'waiting' | 'playing' | 'round_end',
 *     word: string | null                  // 當前題目
 *   }
 * }
 *
 * socketUserMap = {
 *   [socketId]: { roomId, userId, nickname }
 * }
 */

const rooms = {};
const socketUserMap = {};

// 確保某個房間物件存在
function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: {},
      order: [],
      drawerSocketId: null,
      status: "waiting",
      word: null,
    };
  }
}

// 取得某房間的「分數 map」（userId -> score），方便丟給前端顯示
function getRoomScoreMap(roomId) {
  const room = rooms[roomId];
  if (!room) return {};
  const scores = {};
  for (const [socketId, p] of Object.entries(room.players)) {
    scores[p.userId] = p.score;
  }
  return scores;
}

// ====== Socket.io 主事件 ======
io.on("connection", (socket) => {
  console.log("🟢 有人連線：", socket.id);

  // 1️⃣ 加入房間
  // 前端呼叫：
  // socket.emit('joinRoom', { roomId: 'room1', userId: 1, nickname: '小明' });
  socket.on("joinRoom", ({ roomId, userId, nickname }) => {
    if (!roomId || !userId || !nickname) return;

    ensureRoom(roomId);
    const room = rooms[roomId];

    socket.join(roomId);
    socketUserMap[socket.id] = { roomId, userId, nickname };

    // 若這個 socket 第一次進房，加入 players 與 order
    if (!room.players[socket.id]) {
      room.players[socket.id] = {
        userId,
        nickname,
        score: 0,
      };
      room.order.push(socket.id);
    }

    console.log(`👥 ${nickname} (userId=${userId}) 加入房間 ${roomId}`);

    // 回傳目前分數給這個人（只給這個房間的分數）
    const scores = getRoomScoreMap(roomId);
    socket.emit("scoreUpdate", { scores });
  });

  // 2️⃣ 開始回合（畫家出題）
  // payload: { roomId, word }
  socket.on("startRound", ({ roomId, word }) => {
    const userInfo = socketUserMap[socket.id];
    if (!userInfo) return; // 尚未 joinRoom
    if (userInfo.roomId !== roomId) return;
    if (!word) return;

    ensureRoom(roomId);
    const room = rooms[roomId];

    const trimmedWord = String(word).trim();
    if (!trimmedWord) return;

    // 設定房間狀態
    room.word = trimmedWord;
    room.drawerSocketId = socket.id; // 當前畫家 = 這個 socket
    room.status = "playing";

    console.log(
      `🎨 房間 ${roomId} 開始新回合，畫家：${userInfo.nickname}，題目：${trimmedWord}`
    );

    // 告訴畫家：「你現在的題目是什麼」
    socket.emit("roundStartedForDrawer", {
      word: trimmedWord,
    });

    // 告訴其他人在同一房間：有新回合開始，但不要給他們答案，只給字數
    socket.to(roomId).emit("roundStarted", {
      drawerUserId: userInfo.userId,
      drawerNickname: userInfo.nickname,
      wordLength: trimmedWord.length,
    });
  });

  // 3️⃣ 猜題
  // payload: { roomId, text }
  socket.on("guess", ({ roomId, text }) => {
    const userInfo = socketUserMap[socket.id];
    if (!userInfo) return;
    if (userInfo.roomId !== roomId) return;

    const room = rooms[roomId];
    if (!room || room.status !== "playing" || !room.word) {
      console.log("❌ 房間沒有在進行遊戲或尚未出題");
      return;
    }

    const guessRaw = String(text || "").trim();
    if (!guessRaw) return;

    const guess = guessRaw.toLowerCase();
    const answer = room.word.trim().toLowerCase();

    const guesserPlayer = room.players[socket.id];
    const drawerPlayer = room.players[room.drawerSocketId];

    if (!guesserPlayer || !drawerPlayer) return;

    console.log(`📝 房間 ${roomId} 玩家 ${guesserPlayer.nickname} 猜：${guessRaw}`);

    if (guess === answer) {
      // ✅ 猜對
      console.log(`✅ 猜對！答案：${room.word}`);

      room.status = "round_end"; // 標記這回合結束

      // 加分規則：猜對者 +2，畫家 +1
      guesserPlayer.score += 2;
      drawerPlayer.score += 1;

      const scores = getRoomScoreMap(roomId);

      // 把最新分數廣播給整個房間
      io.to(roomId).emit("scoreUpdate", { scores });

      // 廣播回合結束資訊
      io.to(roomId).emit("roundEnded", {
        winnerUserId: guesserPlayer.userId,
        drawerUserId: drawerPlayer.userId,
        answer: room.word,
        scores,
      });

      // 🔄 決定下一個畫家：照 order 輪流
      const order = room.order;
      const currentIndex = order.indexOf(room.drawerSocketId);
      let nextIndex = (currentIndex + 1) % order.length;
      const nextDrawerSocketId = order[nextIndex];
      const nextDrawerPlayer = room.players[nextDrawerSocketId];

      // 更新房間狀態，等待下一回合出題
      room.drawerSocketId = nextDrawerSocketId;
      room.status = "waiting";
      room.word = null;

      // 廣播「下一個輪到誰出題」
      io.to(roomId).emit("nextDrawer", {
        drawerSocketId: nextDrawerSocketId,
        drawerUserId: nextDrawerPlayer.userId,
        drawerNickname: nextDrawerPlayer.nickname,
      });
    } else {
      // ❌ 猜錯，目前就只是 log（之後你可以改成聊天訊息）
      console.log(`❌ 猜錯：${guessRaw}`);
    }
  });

  // 4️⃣ 離線
  socket.on("disconnect", () => {
    console.log("🔴 玩家離線：", socket.id);
    const userInfo = socketUserMap[socket.id];
    if (userInfo) {
      const { roomId, nickname } = userInfo;
      const room = rooms[roomId];

      if (room) {
        // 從 players 移除
        delete room.players[socket.id];

        // 從順序中移除
        room.order = room.order.filter((id) => id !== socket.id);

        // 如果離線的是畫家，把畫家清空，狀態改成 waiting
        if (room.drawerSocketId === socket.id) {
          room.drawerSocketId = null;
          room.status = "waiting";
          room.word = null;
        }

        // 如果房間沒人了，可以選擇把整個房間刪掉
        if (room.order.length === 0) {
          delete rooms[roomId];
        }
      }

      delete socketUserMap[socket.id];
    }
  });
});

// 啟動伺服器
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

