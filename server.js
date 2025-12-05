// server.js (Socket.IO 版本 - 修正與優化)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
// 允許 CORS，讓前端可以在不同網址連線（例如 localhost:3000 連線到 localhost:3000）
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;

// 給前端用的靜態檔案
app.use(express.static("public"));
app.get("/", (req, res) => {
    // 伺服器預設路徑可以導向登入頁
    res.redirect("/login/login.html");
});

// ... (您的資料結構保持不變) ...
const rooms = {};
const socketUserMap = {};

function ensureRoom(roomId) {
    // ... (您的 ensureRoom 函數保持不變) ...
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

function getRoomScoreMap(roomId) {
    // ... (您的 getRoomScoreMap 函數保持不變) ...
    const room = rooms[roomId];
    if (!room) return {};
    const scores = {};
    for (const [socketId, p] of Object.entries(room.players)) {
        scores[p.userId] = p.score;
    }
    return scores;
}

/**
 * 廣播分數、玩家列表、當前畫家資訊到整個房間
 */
function broadcastPlayerList(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const scores = getRoomScoreMap(roomId);
    
    // 建立一個 userId -> { nickname, socketId } 的 Map
    const playerMap = {};
    room.order.forEach(socketId => {
        const player = room.players[socketId];
        if (player) {
            playerMap[player.userId] = { 
                nickname: player.nickname, 
                socketId: socketId 
            };
        }
    });

    io.to(roomId).emit("playerListUpdate", { 
        scores, 
        playerMap, 
        currentDrawerSocketId: room.drawerSocketId 
    });
}


// ============== Socket.IO 連線主事件 ==============
io.on("connection", (socket) => {
    console.log("🟢 有人連線：", socket.id);

    /**
    * 【修正位置！】廣播系統訊息
    * 這個事件監聽器必須放在 io.on('connection') 內部才能訪問 'socket'。
    */
    socket.on("systemMessage", ({ roomId, text }) => {
        io.to(roomId).emit("chatMessage", { 
            nickname: '系統', 
            text, 
            isSystem: true 
        });
    });

    // 1️⃣ 加入房間
    socket.on("joinRoom", ({ roomId, userId, nickname }) => {
        if (!roomId || !userId || !nickname) return;

        // 處理重複登入（強制斷開舊連線，以確保一個使用者 ID 只有一個連線）
        for (const id in socketUserMap) {
            if (socketUserMap[id].userId === userId && id !== socket.id) {
                // 找到舊連線
                const oldSocket = io.sockets.sockets.get(id);
                if (oldSocket) {
                    oldSocket.emit("forceDisconnect", { reason: "您在別處連線" });
                    oldSocket.disconnect(true);
                    console.log(`🔒 強制斷開舊連線: ${id} (userId: ${userId})`);
                }
            }
        }

        ensureRoom(roomId);
        const room = rooms[roomId];

        socket.join(roomId);
        socketUserMap[socket.id] = { roomId, userId, nickname };

        // 檢查是否已存在於房間中
        const isNewPlayer = !Object.values(room.players).some(p => p.userId === userId);

        if (isNewPlayer) {
            room.players[socket.id] = {
                userId,
                nickname,
                score: 0,
            };
            room.order.push(socket.id);
            
            // 有人進房，廣播系統訊息
            io.to(roomId).emit("chatMessage", { 
                nickname: '系統', 
                text: `${nickname} 加入了房間。`, 
                isSystem: true 
            });
        }
        
        console.log(`👥 ${nickname} (userId=${userId}) 加入房間 ${roomId}`);

        // 廣播最新玩家列表與分數
        broadcastPlayerList(roomId); 
        
        // 檢查是否需要設定初始畫家
        if (room.order.length > 0 && room.drawerSocketId === null) {
            // 設定第一個進來的人為畫家
            room.drawerSocketId = room.order[0];
            const initialDrawerNickname = room.players[room.drawerSocketId]?.nickname || '一位玩家';
            // 通知所有人，輪到他出題
            io.to(roomId).emit("nextDrawer", {
                drawerSocketId: room.drawerSocketId,
                drawerNickname: initialDrawerNickname
            });
            broadcastPlayerList(roomId); // 確保畫家標記立即更新
        }

        // 如果遊戲正在進行，新加入的人需要知道遊戲狀態
        if (room.status === 'playing' && room.word && room.drawerSocketId) {
            // 給新加入的猜家
            socket.emit("roundStarted", {
                drawerUserId: room.players[room.drawerSocketId]?.userId,
                drawerNickname: room.players[room.drawerSocketId]?.nickname,
                wordLength: room.word.length,
            });
        }
    });

    // 2️⃣ 開始回合（畫家出題）
    socket.on("startRound", ({ roomId, word }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;

        const room = rooms[roomId];
        if (socket.id !== room.drawerSocketId || room.status === 'playing') return; // 確保只有當前畫家且狀態不是 playing

        const trimmedWord = String(word).trim();
        if (!trimmedWord) return;

        room.word = trimmedWord;
        room.status = "playing";

        console.log(`🎨 房間 ${roomId} 開始新回合，畫家：${userInfo.nickname}，題目：${trimmedWord}`);
        
        // 通知畫家
        socket.emit("roundStartedForDrawer", { word: trimmedWord });

        // 通知猜家：包含 wordLength
        socket.to(roomId).emit("roundStarted", {
            drawerUserId: userInfo.userId,
            drawerNickname: userInfo.nickname,
            wordLength: trimmedWord.length,
        });

        // 系統訊息：回合開始
        io.to(roomId).emit("chatMessage", { 
            nickname: '系統', 
            text: `${userInfo.nickname} 開始作畫！`, 
            isSystem: true 
        });

        // 更新玩家列表，確保畫家標記正確
        broadcastPlayerList(roomId);
    });

    // 3️⃣ 猜題 / 聊天
// 3️⃣ 猜題 / 聊天
socket.on("guess", ({ roomId, text }) => {
    const userInfo = socketUserMap[socket.id];
    if (!userInfo || userInfo.roomId !== roomId) return;
    
    const room = rooms[roomId];
    const guessRaw = String(text || "").trim();
    if (!guessRaw) return;

    // 判斷是否為答案
    if (room && room.status === "playing" && room.word) {
        const guess = guessRaw.toLowerCase();
        const answer = room.word.trim().toLowerCase();
        
        // 畫家送出訊息，視為一般聊天，不進行猜題判斷
        if (socket.id === room.drawerSocketId) {
            io.to(roomId).emit("chatMessage", {
                nickname: userInfo.nickname,
                text: guessRaw
            });
            return;
        }

        if (guess === answer) {
            // 猜對！
            
            // ⚠️ 修正點 1: 確保只有第一個猜對的人會觸發
            if (room.status === "round_end") return; // 已經有人猜對，避免重複執行
            room.status = "round_end"; 

            const guesserPlayer = room.players[socket.id];
            const drawerPlayer = room.players[room.drawerSocketId];
            
            // 避免空值
            if (!guesserPlayer || !drawerPlayer) {
                console.error("玩家或畫家資料遺失。");
                return;
            }
            
            // 加分規則：猜對者 +2，畫家 +1
            guesserPlayer.score += 2;
            drawerPlayer.score += 1;

            // 廣播回合結束資訊
            io.to(roomId).emit("roundEnded", {
                winnerUserId: guesserPlayer.userId,
                drawerUserId: drawerPlayer.userId,
                answer: room.word,
                scores: getRoomScoreMap(roomId), // 傳遞最新分數
            });
            
            // 廣播系統訊息：猜對
            io.to(roomId).emit("chatMessage", { 
                nickname: '系統', 
                text: `${guesserPlayer.nickname} 猜對了！答案是「${room.word}」。`, 
                isSystem: true 
            });

            // 更新分數/列表 (在 nextDrawer 之前執行)
            broadcastPlayerList(roomId); 

            // 🔄 決定下一個畫家 (關鍵修正區域)
            const order = room.order;
            const currentIndex = order.indexOf(room.drawerSocketId);
            let nextDrawerSocketId = null;

            if (currentIndex !== -1) {
                // ⚠️ 修正點 2: nextIndex 必須在 scope 外被定義或使用 let/var
                // 我們直接計算並賦值給 nextDrawerSocketId
                const nextIndex = (currentIndex + 1) % order.length;
                nextDrawerSocketId = order[nextIndex];
            } else if (order.length > 0) {
                // 畫家不在 order 中 (已斷線)，則從頭開始
                nextDrawerSocketId = order[0];
            }

            if (nextDrawerSocketId) {
                const nextDrawerPlayer = room.players[nextDrawerSocketId];
                
                // ⚠️ 修正點 3: 更新房間狀態
                room.drawerSocketId = nextDrawerSocketId; // 更新房間狀態
                room.word = null;
                room.status = "waiting";

                // 廣播「下一個輪到誰出題」
                io.to(roomId).emit("nextDrawer", {
                    drawerSocketId: nextDrawerSocketId,
                    drawerNickname: nextDrawerPlayer.nickname,
                });
                
                // 更新畫家標記 (確保 'nextDrawer' 事件後，前端能更新)
                broadcastPlayerList(roomId);
                
                // 🔔 額外優化：通知所有人清空畫布，準備新回合
                io.to(roomId).emit("canvasCleared"); 

            } else {
                // 如果房間內已經沒有其他玩家
                console.log(`房間 ${roomId} 玩家不足，無法指派下一位畫家。`);
            }

            return; // 猜對，結束
        }
    }
    
    // 猜錯或只是聊天：廣播為一般訊息
    io.to(roomId).emit("chatMessage", {
        nickname: userInfo.nickname,
        text: guessRaw
    });
});
    // 4️⃣ 畫布繪圖
    // payload: { roomId, x0, y0, x1, y1, color, size, tool }
    socket.on("drawing", (data) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== data.roomId) return;
        
        const room = rooms[data.roomId];
        // 僅允許當前畫家廣播繪圖指令，且遊戲狀態為 playing
        if (socket.id === room.drawerSocketId && room.status === 'playing') {
            socket.to(data.roomId).emit("drawing", data); // 廣播給其他房間成員
        }
    });

    // 5️⃣ 清空畫布
    socket.on("clearCanvas", ({ roomId }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;

        const room = rooms[roomId];
        // 僅允許當前畫家廣播清空指令
        if (socket.id === room.drawerSocketId) {
            io.to(roomId).emit("canvasCleared");
            // 系統訊息
            io.to(roomId).emit("chatMessage", { 
                nickname: '系統', 
                text: `${userInfo.nickname} 清空了畫布。`, 
                isSystem: true 
            });
        }
    });

    // 6️⃣ 斷線處理
    socket.on("disconnect", () => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo) return;

        const { roomId, nickname } = userInfo;
        const room = rooms[roomId];
        
        console.log(`❌ ${nickname} (socket=${socket.id}) 斷線`);

        // 從玩家列表中移除
        delete room.players[socket.id];
        room.order = room.order.filter(id => id !== socket.id);
        delete socketUserMap[socket.id];

        // 廣播系統訊息：有人離開
        io.to(roomId).emit("chatMessage", { 
            nickname: '系統', 
            text: `${nickname} 離開了房間。`, 
            isSystem: true 
        });

        // 檢查是否為畫家離開
        let drawerReassigned = false;
        if (room.drawerSocketId === socket.id) {
            console.log(`🔔 畫家 ${nickname} 離開，重新指派畫家。`);
            
            room.drawerSocketId = null; 
            room.status = 'waiting'; // 遊戲狀態變為等待
            room.word = null;

            // 檢查是否還有其他玩家
            if (room.order.length > 0) {
                // 指派下一個人當畫家
                const nextDrawerSocketId = room.order[0];
                const nextDrawerPlayer = room.players[nextDrawerSocketId];
                room.drawerSocketId = nextDrawerSocketId;
                drawerReassigned = true;

                io.to(roomId).emit("nextDrawer", {
                    drawerSocketId: nextDrawerSocketId,
                    drawerNickname: nextDrawerPlayer.nickname,
                });

                // 通知所有非畫家清除畫布，因為新一輪遊戲需要重新開始
                io.to(roomId).emit("canvasCleared");
            }
        } else if (room.drawerSocketId && !room.players[room.drawerSocketId]) {
            // 優化: 如果畫家還在 room.drawerSocketId 但實際已斷線，重新指派
            if (room.order.length > 0) {
                const nextDrawerSocketId = room.order[0];
                const nextDrawerPlayer = room.players[nextDrawerSocketId];
                room.drawerSocketId = nextDrawerSocketId;
                room.status = 'waiting';
                room.word = null;
                drawerReassigned = true;

                io.to(roomId).emit("nextDrawer", {
                    drawerSocketId: nextDrawerSocketId,
                    drawerNickname: nextDrawerPlayer.nickname,
                });
                io.to(roomId).emit("canvasCleared");
            }
        }
        
        // 更新分數/玩家列表
        broadcastPlayerList(roomId);

        // 如果房間沒人了，可以清掉房間物件
        if (room.order.length === 0) {
            delete rooms[roomId];
            console.log(`🧹 房間 ${roomId} 已清空並移除。`);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Socket.IO 伺服器已啟動!`);
    console.log(`👉 前端請在瀏覽器開啟: http://localhost:${PORT}`);
});