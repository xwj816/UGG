// server.js (Socket.IO 版本 - 修正分數同步 Bug)
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
const ROUND_DURATION = 60; // 60秒

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
            timer: null,
            timeLeft: 0,
            guessedCount: 0
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
                // ★★★ 關鍵修正：必須包含 userId，前端才能對照分數 ★★★
                userId: player.userId, 
                nickname: player.nickname, 
                socketId: socketId,
                hasGuessed: player.hasGuessed
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

// --- 計時器 ---
function startTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.timer) clearInterval(room.timer);

    room.timeLeft = ROUND_DURATION;
    
    // 立即廣播初始時間
    io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });

    room.timer = setInterval(() => {
        room.timeLeft--;

        // 倒數 30秒, 10秒, 5秒... 或每 5 秒同步一次 (減少頻寬消耗)
        // 為了流暢度，這裡每秒廣播
        io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });

        if (room.timeLeft <= 0) {
            endRound(roomId, "時間到！");
        }
    }, 1000);
}

function stopTimer(roomId) {
    const room = rooms[roomId];
    if (room && room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
}

function endRound(roomId, reasonMsg) {
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;

    stopTimer(roomId);
    room.status = "round_end";

    // 結算畫家分數
    const drawerPlayer = room.players[room.drawerSocketId];
    if (drawerPlayer && room.guessedCount > 0) {
        const drawerPoints = Math.min(room.guessedCount * 10, 50);
        drawerPlayer.score += drawerPoints;
        sendSystemMessage(roomId, `畫家 ${drawerPlayer.nickname} 獲得了 ${drawerPoints} 分！`);
    }

    io.to(roomId).emit("roundEnded", {
        winnerUserId: null, 
        answer: room.word,
        scores: getRoomScoreMap(roomId), // 傳送最終分數
        reason: reasonMsg
    });

    sendSystemMessage(roomId, `${reasonMsg} 答案是「${room.word}」。`);
    broadcastPlayerList(roomId); // 更新前端列表

    setTimeout(() => {
        nextDrawer(roomId);
    }, 4000);
}

function nextDrawer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const order = room.order;
    const currentIndex = order.indexOf(room.drawerSocketId);
    let nextDrawerSocketId = null;

    if (currentIndex !== -1) {
        const nextIndex = (currentIndex + 1) % order.length;
        nextDrawerSocketId = order[nextIndex];
    } else if (order.length > 0) {
        nextDrawerSocketId = order[0];
    }

    if (nextDrawerSocketId) {
        const nextDrawerPlayer = room.players[nextDrawerSocketId];
        room.drawerSocketId = nextDrawerSocketId;
        room.word = null;
        room.status = "waiting";
        room.timeLeft = 0;
        room.guessedCount = 0;
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

// ============== Socket.IO 連線 ==============

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
        
        if (room.order.length > 0 && room.drawerSocketId === null) {
            room.drawerSocketId = room.order[0];
            const initialDrawerNickname = room.players[room.drawerSocketId]?.nickname || '一位玩家';
            io.to(roomId).emit("nextDrawer", {
                drawerSocketId: room.drawerSocketId,
                drawerNickname: initialDrawerNickname
            });
        }

        broadcastPlayerList(roomId);

        if (room.status === 'playing' && room.word && room.drawerSocketId) {
            socket.emit("roundStarted", {
                drawerUserId: room.players[room.drawerSocketId]?.userId,
                drawerNickname: room.players[room.drawerSocketId]?.nickname,
                wordLength: room.word.length,
            });
            socket.emit("timerUpdate", { timeLeft: room.timeLeft, total: ROUND_DURATION });
        }
    });

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
        Object.values(room.players).forEach(p => p.hasGuessed = false);

        socket.emit("roundStartedForDrawer", { word: trimmedWord });
        socket.to(roomId).emit("roundStarted", {
            drawerUserId: userInfo.userId,
            drawerNickname: userInfo.nickname,
            wordLength: trimmedWord.length,
        });

        sendSystemMessage(roomId, `${userInfo.nickname} 開始作畫！`);
        broadcastPlayerList(roomId);
        startTimer(roomId);
    });

    socket.on("guess", ({ roomId, text }) => {
        const userInfo = socketUserMap[socket.id];
        if (!userInfo || userInfo.roomId !== roomId) return;
        
        const room = rooms[roomId];
        const guessRaw = String(text || "").trim();
        if (!guessRaw) return;

        if (room && room.status === "playing" && room.word) {
            const guess = guessRaw.toLowerCase();
            const answer = room.word.trim().toLowerCase();
            
            if (socket.id === room.drawerSocketId) {
                io.to(roomId).emit("chatMessage", { nickname: userInfo.nickname, text: guessRaw });
                return;
            }

            if (room.players[socket.id].hasGuessed) {
                 io.to(roomId).emit("chatMessage", { nickname: userInfo.nickname, text: guessRaw });
                 return;
            }

            if (guess === answer) {
                const guesserPlayer = room.players[socket.id];
                if (guesserPlayer) {
                    const timeRatio = room.timeLeft / ROUND_DURATION;
                    const scoreGained = Math.ceil(10 + (timeRatio * 50));
                    
                    guesserPlayer.score += scoreGained;
                    guesserPlayer.hasGuessed = true;
                    room.guessedCount++;

                    socket.emit("chatMessage", { 
                        nickname: '系統', 
                        text: `恭喜答對！獲得 ${scoreGained} 分！`, 
                        isSystem: true 
                    });

                    socket.to(roomId).emit("chatMessage", { 
                        nickname: '系統', 
                        text: `${userInfo.nickname} 猜對了答案！`, 
                        isSystem: true 
                    });

                    broadcastPlayerList(roomId);

                    const totalGuessers = room.order.length - 1; 
                    if (room.guessedCount >= totalGuessers && totalGuessers > 0) {
                        endRound(roomId, "所有人都猜對了！");
                    }
                }
                return; 
            }
        }
        
        io.to(roomId).emit("chatMessage", { nickname: userInfo.nickname, text: guessRaw });
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
        
        if (room) {
            delete room.players[socket.id];
            room.order = room.order.filter(id => id !== socket.id);
            sendSystemMessage(roomId, `${nickname} 離開了房間。`);

            if (room.drawerSocketId === socket.id) {
                stopTimer(roomId);
                nextDrawer(roomId);
            }
            else if (room.status === 'playing') {
                const totalGuessers = room.order.length - 1;
                if (room.guessedCount >= totalGuessers && totalGuessers > 0) {
                    endRound(roomId, "所有人都猜對了！");
                }
            }
            broadcastPlayerList(roomId);

            if (room.order.length === 0) {
                stopTimer(roomId);
                delete rooms[roomId];
            }
        }
        delete socketUserMap[socket.id];
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Socket.IO 伺服器已啟動! http://localhost:${PORT}`);
});