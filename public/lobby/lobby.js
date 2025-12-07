// lobby/lobby.js
const socket = io(); // 連線到 Socket.IO 伺服器

// --- 全域變數 ---
let USERNAME = '';
let USER_ID = '';
let ROOM_ID = '';
let IS_DRAWER = false; // 用來判斷是否為畫家 (只有畫家能畫圖)
let currentWordLength = 0; // 猜家看的字數
let canvas, ctx;

// --- 畫布變數 ---
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#000000';
let currentSize = 5;
let currentTool = 'pen'; // 'pen' 或 'eraser'

// --- DOM 元素 ---
const messagesEl = document.getElementById('messages');
const chatInput = document.getElementById('chatInput');
const guessForm = document.getElementById('guessForm');
const wordModal = document.getElementById('wordModal');
const wordForm = document.getElementById('wordForm');
const wordInput = document.getElementById('wordInput');
const currentWordDisplay = document.getElementById('currentWordDisplay');
const gameStatusEl = document.getElementById('gameStatus');
const playerListEl = document.getElementById('playerList');
const startRoundButton = document.getElementById('startRoundButton');

// ----------------------------------------
// I. 初始化 & URL 參數處理
// ----------------------------------------

function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        username: params.get("username"),
        roomID: params.get("roomID"),
        userId: params.get("userId"),
    };
}

function initGame() {
    const { username, roomID, userId } = getUrlParams();

    if (!username || !roomID || !userId) {
        alert("缺少必要的用戶資訊或房間 ID，將返回登入頁。");
        window.location.href = "../login/login.html";
        return;
    }

    USERNAME = username;
    USER_ID = userId;
    ROOM_ID = roomID;

    document.getElementById('roomTitle').textContent = `房間：${ROOM_ID}`;
    
    // 1. 連線到伺服器並加入房間
    socket.emit('joinRoom', { 
        roomId: ROOM_ID, 
        userId: USER_ID, 
        nickname: USERNAME 
    });

    // 2. 初始化畫布
    initCanvas();

    // 3. 事件監聽 (畫布工具、聊天、遊戲流程)
    setupEventListeners();

    // 預設狀態：猜家/等待
    toggleDrawerControls(false); 
    gameStatusEl.textContent = '等待玩家加入並開始遊戲...';
}

// ----------------------------------------
// II. 畫布操作 (Drawer & Socket) - 支援觸控版
// ----------------------------------------

// 1. 新增一個函數：統一取得座標 (滑鼠/觸控 都能用)
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    
    // 計算 CSS 縮放比例 (解決手機螢幕寬度導致的座標偏移)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
        // 如果是觸控事件，取第一根手指的位置
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        // 如果是滑鼠事件
        clientX = e.clientX;
        clientY = e.clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function initCanvas() {
    canvas = document.getElementById('drawingCanvas');
    ctx = canvas.getContext('2d');
    
    // 設定畫布尺寸
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    // 監聽視窗改變大小，重設畫布尺寸 (避免變形)
    window.addEventListener('resize', () => {
        // 簡單重設，注意：這會清空當前畫布
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        // 重設後需重新套用畫筆樣式
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = currentSize;
        ctx.strokeStyle = currentColor;
    });
    
    // 預設畫筆設定
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = currentSize;
    ctx.strokeStyle = currentColor;

    // --- 定義事件處理函數 ---

    const startDraw = (e) => {
        if (!IS_DRAWER) return;
        // 如果是觸控，阻止默認行為(捲動)
        if (e.type === 'touchstart') e.preventDefault();

        isDrawing = true;
        const pos = getPos(e);
        [lastX, lastY] = [pos.x, pos.y];
        
        // 點一下也要畫一個點
        draw(e); 
    };

    const moveDraw = (e) => {
        if (!IS_DRAWER || !isDrawing) return;
        if (e.type === 'touchmove') e.preventDefault();
        
        draw(e);
    };

    const endDraw = (e) => {
        isDrawing = false;
    };

    // --- 綁定滑鼠事件 ---
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseout', endDraw);

    // --- 綁定觸控事件 (關鍵) ---
    // passive: false 允許我們使用 preventDefault() 來阻止捲動
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    // 清空畫布功能
    document.getElementById('clearCanvas').addEventListener('click', () => {
        if (!IS_DRAWER) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { roomId: ROOM_ID });
    });
}

function draw(e) {
    if (!isDrawing) return;
    
    // 使用 getPos 取得正確座標
    const pos = getPos(e);
    const newX = pos.x;
    const newY = pos.y;

    // 在本地畫
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(newX, newY);
    ctx.strokeStyle = (currentTool === 'pen') ? currentColor : '#FFFFFF';
    ctx.lineWidth = currentSize;
    ctx.stroke();

    // 將線段資料傳給伺服器廣播
    socket.emit('drawing', {
        roomId: ROOM_ID,
        x0: lastX,
        y0: lastY,
        x1: newX,
        y1: newY,
        color: currentColor,
        size: currentSize,
        tool: currentTool
    });

    [lastX, lastY] = [newX, newY];
}

// 接收伺服器廣播的繪圖指令 (保持不變)
socket.on('drawing', (data) => {
    ctx.beginPath();
    ctx.moveTo(data.x0, data.y0);
    ctx.lineTo(data.x1, data.y1);
    ctx.strokeStyle = (data.tool === 'pen') ? data.color : '#FFFFFF';
    ctx.lineWidth = data.size;
    ctx.stroke();
});

// 接收伺服器廣播的清空指令 (保持不變)
socket.on('canvasCleared', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log("畫布已清空。");
});

// ----------------------------------------
// III. 遊戲狀態與 Socket 事件處理
// ----------------------------------------

function setupEventListeners() {
    // 聊天/猜測表單提交
    guessForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
            // 伺服器會判斷是訊息還是猜對答案
            socket.emit('guess', { roomId: ROOM_ID, text: text });
            chatInput.value = ''; // 清空輸入框
        }
    });

    // 畫家出題表單提交
    wordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const word = wordInput.value.trim();
        if (word && IS_DRAWER) {
            socket.emit('startRound', { roomId: ROOM_ID, word: word });
            wordModal.style.display = 'none';
        }
    });

    // 工具列按鈕
    document.querySelectorAll('.tool-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const tool = e.currentTarget.dataset.tool;
            if (tool) {
                currentTool = tool;
                // 視覺更新：只有當前工具按鈕 active
                document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
                e.currentTarget.classList.add('active');
            }
        });
    });

    // 顏色/尺寸選擇器
    document.getElementById('colorPicker').addEventListener('input', (e) => {
        currentColor = e.target.value;
    });
    document.getElementById('sizeSlider').addEventListener('input', (e) => {
        currentSize = parseInt(e.target.value);
    });

    // 畫家按鈕：顯示出題 Modal
    startRoundButton.addEventListener('click', () => {
        if (IS_DRAWER) {
            wordModal.style.display = 'block';
        } else {
            console.log("只有畫家可以開始回合。");
        }
    });
}

/**
 * 更新玩家列表和分數
 * @param {object} scores - { userId: score, ... }
 * @param {object} playerMap - { userId: { nickname, socketId }, ... }
 * @param {string} currentDrawerSocketId - 當前畫家的 socket ID
 */
function updateScoreboard(scores, playerMap, currentDrawerSocketId) {
    playerListEl.innerHTML = '';
    
    // 將 playerMap 轉成陣列並依分數排序
    const sortedPlayers = Object.values(playerMap)
        .sort((a, b) => (scores[b.userId] || 0) - (scores[a.userId] || 0));

    sortedPlayers.forEach(p => {
        const score = scores[p.userId] || 0;
        const isSelf = p.userId === USER_ID;
        const isDrawer = p.socketId === currentDrawerSocketId;
        
        const li = document.createElement('li');
        li.classList.add('player-item');
        if (isSelf) li.classList.add('self');
        if (isDrawer) li.classList.add('drawer');

        li.innerHTML = `
            ${isDrawer ? '🎨' : ''}
            <span class="player-name">${p.nickname}</span> 
            <span class="score">${score}</span>
        `;
        playerListEl.appendChild(li);
    });
}

/**
 * 啟用/禁用畫家專屬的控制項（畫布繪圖、工具列、開始按鈕）
 * @param {boolean} isDrawer - 是否為畫家
 */
function toggleDrawerControls(isDrawer) {
    IS_DRAWER = isDrawer;
    // 畫布本身 (mouseup/down/move) 已經在 draw 函式內判斷 IS_DRAWER

    const controls = [
        document.getElementById('colorPicker'),
        document.getElementById('sizeSlider'),
        document.getElementById('clearCanvas')
    ];
    
    controls.forEach(control => {
        control.disabled = !isDrawer;
        control.style.opacity = isDrawer ? '1' : '0.5';
    });

    // 開始回合按鈕
    startRoundButton.style.display = isDrawer ? 'inline-block' : 'none';
}


// ----------------------------------------
// IV. Socket.IO 伺服器回傳事件
// ----------------------------------------

// 接收：分數/玩家列表更新
// data: { scores: { userId: score, ... }, playerMap: { userId: { nickname, socketId }, ... }, currentDrawerSocketId: '...' }
socket.on('playerListUpdate', ({ scores, playerMap, currentDrawerSocketId }) => {
    updateScoreboard(scores, playerMap, currentDrawerSocketId);
});

// 接收：有人傳訊息（或猜錯）
// data: { nickname, text }
socket.on('chatMessage', ({ nickname, text, isSystem = false }) => {
    const p = document.createElement('p');
    p.classList.add('message');
    if (isSystem) {
        p.classList.add('system-message');
        p.innerHTML = `<span class="system">${text}</span>`;
    } else {
        p.innerHTML = `<span class="user">${nickname}：</span>${text}`;
    }
    messagesEl.appendChild(p);
    messagesEl.scrollTop = messagesEl.scrollHeight; // 自動捲到底
});


// 接收：回合開始 (猜家視角)
// data: { drawerUserId, drawerNickname, wordLength }
socket.on('roundStarted', ({ drawerUserId, drawerNickname, wordLength }) => {
    currentWordLength = wordLength;
    gameStatusEl.textContent = `${drawerNickname} 正在作畫...`;
    currentWordDisplay.textContent = `共有 ${wordLength} 個字...`;

    // 確保自己不是畫家
    if (String(drawerUserId) !== USER_ID) {
        toggleDrawerControls(false); 
    }
    
    // 清空畫布，準備新回合
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});


// 接收：回合開始 (畫家視角)
// data: { word }
socket.on('roundStartedForDrawer', ({ word }) => {
    gameStatusEl.textContent = `你的題目是：${word}`;
    currentWordDisplay.textContent = `✍️ 你的題目：${word}`;
    toggleDrawerControls(true); // 確定自己是畫家
});


// 接收：回合結束 (有人猜對)
// data: { winnerUserId, drawerUserId, answer, scores }
socket.on('roundEnded', ({ winnerUserId, drawerUserId, answer }) => {
    const isWinner = String(winnerUserId) === USER_ID;
    const isDrawer = String(drawerUserId) === USER_ID;
    
    let message = `🎯 回合結束！答案是「${answer}」。`;
    if (isWinner) {
        message += "恭喜你答對！";
    } else {
        message += "請準備下一回合。";
    }

    // 顯示系統訊息
    socket.emit('systemMessage', { roomId: ROOM_ID, text: message });
    
    gameStatusEl.textContent = `✅ 答案揭曉：${answer}！請等待下一位畫家。`;
    currentWordDisplay.textContent = '答案已揭曉，請等待下一回合...';
    
    toggleDrawerControls(false); // 回合結束，先鎖定控制
});


// 接收：輪到下一個畫家出題
// data: { drawerSocketId, drawerNickname }
socket.on('nextDrawer', ({ drawerSocketId, drawerNickname }) => {
    const isNextDrawer = socket.id === drawerSocketId;
    
    gameStatusEl.textContent = `請 ${drawerNickname} 出題！`;
    currentWordDisplay.textContent = '等待畫家出題中...';

    if (isNextDrawer) {
        toggleDrawerControls(true); // 輪到我了！
        // 彈出出題 Modal
        wordModal.style.display = 'block'; 
        // 清空畫布 (給新畫家用)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
        toggleDrawerControls(false);
    }
});


// 頁面載入時執行
document.addEventListener("DOMContentLoaded", initGame);