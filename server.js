// server.js (Socket.IO 版本 - 完善計分與計時版)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const PORT = 3000;

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));
app.get("/", (req, res) => {
    res.redirect("/login/login.html");
});

// --- 設定 ---
const ROUND_DURATION = 60; // 每回合 60 秒

// --- 資料結構 ---
const rooms = {};
const socketUserMap = {};

function ensureRoom(roomId) {
    if (!rooms[roomId]) {
        rooms[roomId] = {
            players: {},
            order: [],
            drawerSocketId: null,
            status: "waiting",
            word: null,
            timer: null,      // 計時器物件
            timeLeft: 0,      // 剩餘時間
            guessedCount: 0   // 這回合猜對的人數
        };
    }
}

function getRoomScoreMap(roomId) {
    const room = rooms[roomId];
    if (!room) return {};
    const scores = {};
    for (const [socketId, p] of Object.entries(room.players)) {
        scores[p.userId] = p.score;
    }
    return scores;
}

function broadcastPlayerList(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const scores = getRoomScoreMap(roomId);
    
    const playerMap = {};
    room.order.forEach(socketId => {
        const player = room.players[socketId];
        if (player) {
            playerMap[player.userId] = { 
                nickname: player.nickname, 
                socketId: socketId,
                hasGuessed: player.hasGuessed // 讓前端知道誰猜對了(打勾勾)
            };
        }
    });

    io.to(roomId).emit("playerListUpdate", { 
        scores, 
        playerMap, 
        currentDrawerSocketId: room.drawerSocketId 
    });
}

function sendSystemMessage(roomId, text) {
    io.to(roomId).emit("chatMessage", { 
        nickname: '系統', 
        text, 
        isSystem: true 
    });
}

// --- 計時器相關函式 ---

/**
 * 啟動房間計時器
 */
function startTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // 清除舊計時器
    if (room.timer) clearInterval(room.timer);

    room.timeLeft = ROUND_DURATION;
    
    // 廣播初始時間
    io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });

    room.timer = setInterval(() => {
        room.timeLeft--;

        // 每秒廣播一次時間 (或前端自己倒數，後端只做校正，這裡簡單做每秒廣播)
        if (room.timeLeft % 5 === 0 || room.timeLeft <= 10) { // 優化：只在特定時間點廣播
             io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });
        }

        if (room.timeLeft <= 0) {
            endRound(roomId, "時間到！");
        }
    }, 1000);
}

/**
 * 停止房間計時器
 */
function stopTimer(roomId) {
    const room = rooms[roomId];
    if (room && room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
}

/**
 * 結束回合邏輯 (封裝起來，因為有多個觸發點：猜對、時間到、斷線)
 */
function endRound(roomId, reasonMsg) {
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;

    stopTimer(roomId);
    room.status = "round_end";

    // 結算畫家分數 (如果有猜對的人)
    const drawerPlayer = room.players[room.drawerSocketId];
    if (drawerPlayer && room.guessedCount > 0) {
        // 畫家得分公式：每有一個人猜對得 10 分 (上限 50 分避免洗分)
        const drawerPoints = Math.min(room.guessedCount * 10, 50);
        drawerPlayer.score += drawerPoints;
        sendSystemMessage(roomId, `畫家 ${drawerPlayer.nickname} 因大家猜對獲得了 ${drawerPoints} 分！`);
    }

    // 廣播結果
    io.to(roomId).emit("roundEnded", {
        winnerUserId: null, // 這裡不再強調單一贏家，而是揭曉答案
        answer: room.word,
        scores: getRoomScoreMap(roomId),
        reason: reasonMsg
    });

    sendSystemMessage(roomId, `${reasonMsg} 答案是「${room.word}」。`);
    broadcastPlayerList(roomId);

    // 準備下一位
    setTimeout(() => {
        nextDrawer(roomId);
    }, 4000); // 4秒後自動下一局
}

/**
 * 切換下一位畫家
 */
function nextDrawer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const order = room.order;
    // 找出當前畫家的索引
    const currentIndex = order.indexOf(room.drawerSocketId);
    let nextDrawerSocketId = null;

    if (currentIndex !== -1) {
        const nextIndex = (currentIndex + 1) % order.length;
        nextDrawerSocketId = order[nextIndex];
    } else if (order.length > 0) {
        nextDrawerSocketId = order[0];
    }

    // 重置回合狀態
    if (nextDrawerSocketId) {
        const nextDrawerPlayer = room.players[nextDrawerSocketId];
        room.drawerSocketId = nextDrawerSocketId;
        room.word = null;
        room.status = "waiting";
        room.timeLeft = 0;
        room.guessedCount = 0;

        // 重置所有玩家的 "hasGuessed" 狀態
        Object.values(room.players).forEach(p => p.hasGuessed = false);

        io.to(roomId).emit("nextDrawer", {
            drawerSocketId: nextDrawerSocketId,
            drawerNickname: nextDrawerPlayer.nickname,
        });
        
        io.to(roomId).emit("canvasCleared");
        broadcastPlayerList(roomId);
    } else {
        console.log(`房間 ${roomId} 玩家不足，無法繼續。`);
    }
}

// ============== Socket.IO 連線主邏輯 ==============

io.on("connection", (socket) => {
    console.log("🟢 有人連線：", socket.id);

    socket.on("systemMessage", ({ roomId, text }) => {
        sendSystemMessage(roomId, text);
    });

    socket.on("joinRoom", ({ roomId, userId, nickname }) => {
        if (!roomId || !userId || !nickname) return;

        for (const id in socketUserMap) {
            if (socketUserMap[id].userId === userId && id !== socket.id) {
                const oldSocket = io.sockets.sockets.get(id);
                if (oldSocket) {
                    oldSocket.emit("forceDisconnect", { reason: "您在別處連線" });
                    oldSocket.disconnect(true);
                }
            }
        }

        ensureRoom(roomId);
        const room = rooms[roomId];

        socket.join(roomId);
        socketUserMap[socket.id] = { roomId, userId, nickname };

        const isNewPlayer = !Object.values(room.players).some(p => p.userId === userId);
        if (isNewPlayer) {
            room.players[socket.id] = {
                userId,
                nickname,
                score: 0,
                hasGuessed: false
            };
            room.order.push(socket.id);
            sendSystemMessage(roomId, `${nickname} 加入了房間。`);
        }
        
        // 初始畫家檢查
        if (room.order.length > 0 && room.drawerSocketId === null) {
            room.drawerSocketId = room.order[0];
            const initialDrawerNickname = room.players[room.drawerSocketId]?.nickname || '一位玩家';
            io.to(roomId).emit("nextDrawer", {
                drawerSocketId: room.drawerSocketId,
                drawerNickname: initialDrawerNickname
            });
        }

        broadcastPlayerList(roomId);

        // 中途加入同步狀態
        if (room.status === 'playing' && room.word && room.drawerSocketId) {
            socket.emit("roundStarted", {
                drawerUserId: room.players[room.drawerSocketId]?.userId,
                drawerNickname: room.players[room.drawerSocketId]?.nickname,
                wordLength: room.word.length,
            });
            // 同步時間
            socket.emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });
        }
    });

    // 開始回合
    socket.on("startRound", ({ roomId, word }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;
        const room = rooms[roomId];
        if (socket.id !== room.drawerSocketId || room.status === 'playing') return;

        const trimmedWord = String(word).trim();
        if (!trimmedWord) return;

        room.word = trimmedWord;
        room.status = "playing";
        room.guessedCount = 0;
        // 重置本回合猜題狀態
        Object.values(room.players).forEach(p => p.hasGuessed = false);

        socket.emit("roundStartedForDrawer", { word: trimmedWord });
        socket.to(roomId).emit("roundStarted", {
            drawerUserId: userInfo.userId,
            drawerNickname: userInfo.nickname,
            wordLength: trimmedWord.length,
        });

        sendSystemMessage(roomId, `${userInfo.nickname} 開始作畫！`);
        broadcastPlayerList(roomId);
        
        // ★★★ 啟動計時器 ★★★
        startTimer(roomId);
    });

    // 猜題 / 聊天
    socket.on("guess", ({ roomId, text }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;
        
        const room = rooms[roomId];
        const guessRaw = String(text || "").trim();
        if (!guessRaw) return;

        if (room && room.status === "playing" && room.word) {
            const guess = guessRaw.toLowerCase();
            const answer = room.word.trim().toLowerCase();
            
            // 畫家發言
            if (socket.id === room.drawerSocketId) {
                io.to(roomId).emit("chatMessage", { nickname: userInfo.nickname, text: guessRaw });
                return;
            }

            // 已經猜對的人不能再猜 (避免重複刷分)
            if (room.players[socket.id].hasGuessed) {
                 io.to(roomId).emit("chatMessage", { nickname: userInfo.nickname, text: guessRaw });
                 return;
            }

            // 猜對邏輯
            if (guess === answer) {
                const guesserPlayer = room.players[socket.id];
                
                if (guesserPlayer) {
                    // ★★★ 時間積分公式 ★★★
                    // 基礎分 10 + (剩餘時間比例 * 50)
                    // 例如剩 60秒(剛開始) = 10 + 50 = 60分
                    // 剩 30秒 = 10 + 25 = 35分
                    // 剩 1秒 = 10 + 0 = 10分
                    const timeRatio = room.timeLeft / ROUND_DURATION;
                    const scoreGained = Math.ceil(10 + (timeRatio * 50));
                    
                    guesserPlayer.score += scoreGained;
                    guesserPlayer.hasGuessed = true; // 標記為已猜對
                    room.guessedCount++;

                    // 私訊通知該玩家得分
                    socket.emit("chatMessage", { 
                        nickname: '系統', 
                        text: `恭喜答對！獲得 ${scoreGained} 分！`, 
                        isSystem: true 
                    });

                    // 廣播給其他人：某人猜對了（不顯示答案）
                    socket.to(roomId).emit("chatMessage", { 
                        nickname: '系統', 
                        text: `${userInfo.nickname} 猜對了答案！`, 
                        isSystem: true 
                    });

                    // 更新列表(顯示打勾或分數)
                    broadcastPlayerList(roomId);

                    // ★★★ 檢查是否所有人都猜對了 ★★★
                    // 總人數 - 1 (畫家)
                    const totalGuessers = room.order.length - 1; 
                    if (room.guessedCount >= totalGuessers && totalGuessers > 0) {
                        endRound(roomId, "所有人都猜對了！");
                    }
                }
                return; 
            }
        }
        
        // 猜錯或閒聊
        io.to(roomId).emit("chatMessage", {
            nickname: userInfo.nickname,
            text: guessRaw
        });
    });

    socket.on("drawing", (data) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== data.roomId) return;
        const room = rooms[data.roomId];
        if (room && socket.id === room.drawerSocketId && room.status === 'playing') {
            socket.to(data.roomId).emit("drawing", data);
        }
    });

    socket.on("clearCanvas", ({ roomId }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;
        const room = rooms[roomId];
        if (room && socket.id === room.drawerSocketId) {
            io.to(roomId).emit("canvasCleared");
        }
    });

    socket.on("disconnect", () => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo) return;
        const { roomId, nickname } = userInfo;
        const room = rooms[roomId];
        
        console.log(`❌ ${nickname} (socket=${socket.id}) 斷線`);

        if (room) {
            delete room.players[socket.id];
            room.order = room.order.filter(id => id !== socket.id);
            sendSystemMessage(roomId, `${nickname} 離開了房間。`);

            // 如果畫家斷線
            if (room.drawerSocketId === socket.id) {
                stopTimer(roomId); // 停止倒數
                console.log(`🔔 畫家離開，重新指派...`);
                nextDrawer(roomId);
            }
            // 如果玩家斷線，檢查是否需要提早結束回合 (因為剩餘玩家可能都猜過了)
            else if (room.status === 'playing') {
                const totalGuessers = room.order.length - 1;
                if (room.guessedCount >= totalGuessers && totalGuessers > 0) {
                    endRound(roomId, "所有人都猜對了！");
                }
            }

            broadcastPlayerList(roomId);

            if (room.order.length === 0) {
                stopTimer(roomId); // 清除計時器
                delete rooms[roomId];
                console.log(`🧹 房間 ${roomId} 已移除。`);
            }
        }
        delete socketUserMap[socket.id];
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Socket.IO 伺服器已啟動!`);
    console.log(`👉 http://localhost:${PORT}`);
});