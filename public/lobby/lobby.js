// lobby/lobby.js - 完整版

const socket = io(); 

// --- 全域變數 ---
let USERNAME = '';
let USER_ID = '';
let ROOM_ID = '';
let IS_DRAWER = false; 
let canvas, ctx;

// --- 畫布與顏色設定 ---
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#000000';
let currentSize = 5;
let currentTool = 'pen'; 

// 色票
const COLORS = [
    '#000000', '#555555', '#ffffff', '#ff0000', '#ff7f00', '#ffff00', 
    '#00ff00', '#00ffff', '#0000ff', '#9b00ff', '#ff69b4', '#8b4513'
];

// --- DOM 元素 ---
const els = {
    messages: document.getElementById('messages'),
    chatInput: document.getElementById('chatInput'),
    guessForm: document.getElementById('guessForm'),
    wordModal: document.getElementById('wordModal'),
    wordForm: document.getElementById('wordForm'),
    wordInput: document.getElementById('wordInput'),
    currentWordDisplay: document.getElementById('currentWordDisplay'),
    gameStatus: document.getElementById('gameStatus'),
    playerList: document.getElementById('playerList'),
    startRoundBtn: document.getElementById('startRoundButton'),
    roomTitle: document.getElementById('roomTitle'),
    timerBar: document.getElementById('timerBar') // 必須與 HTML ID 對應
};

// ... (Get Url Params & Init Game) ...

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
        alert("資料不完整");
        window.location.href = "../login/login.html";
        return;
    }
    USERNAME = username;
    USER_ID = userId;
    ROOM_ID = roomID;
    if (els.roomTitle) els.roomTitle.textContent = `房間：${ROOM_ID}`;
    socket.emit('joinRoom', { roomId: ROOM_ID, userId: USER_ID, nickname: USERNAME });

    initCanvas();
    setupEventListeners();
    initColorPalette();

    toggleDrawerControls(false); 
    els.startRoundBtn.style.display = 'none'; 
    els.gameStatus.textContent = '等待遊戲開始...';
}

function initColorPalette() {
    const paletteContainer = document.getElementById('colorPalette');
    if (!paletteContainer) return;
    paletteContainer.innerHTML = '';
    COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.addEventListener('click', () => selectColor(color));
        if (color === currentColor) swatch.classList.add('active');
        paletteContainer.appendChild(swatch);
    });
}

function selectColor(color) {
    currentColor = color;
    currentTool = 'pen'; 
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        const temp = document.createElement('div');
        temp.style.color = color;
        document.body.appendChild(temp);
        const targetColor = window.getComputedStyle(temp).color;
        document.body.removeChild(temp);
        if (swatch.style.backgroundColor === targetColor) swatch.classList.add('active');
        else swatch.classList.remove('active');
    });
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    const penBtn = document.getElementById('toolPen');
    if(penBtn) penBtn.classList.add('active');
}

// ... (Canvas Logic) ...
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = e.clientX, clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function initCanvas() {
    canvas = document.getElementById('drawingCanvas');
    ctx = canvas.getContext('2d');
    const resizeCanvas = () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.lineWidth = currentSize; ctx.strokeStyle = currentColor;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const startDraw = (e) => { if (IS_DRAWER) { if(e.type==='touchstart')e.preventDefault(); isDrawing=true; const p=getPos(e); lastX=p.x; lastY=p.y; draw(e); }};
    const moveDraw = (e) => { if (IS_DRAWER && isDrawing) { if(e.type==='touchmove')e.preventDefault(); draw(e); }};
    const endDraw = () => { isDrawing = false; };

    canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw); canvas.addEventListener('mouseout', endDraw);
    canvas.addEventListener('touchstart', startDraw, {passive:false}); canvas.addEventListener('touchmove', moveDraw, {passive:false});
    canvas.addEventListener('touchend', endDraw);

    document.getElementById('clearCanvas').addEventListener('click', () => {
        if (!IS_DRAWER) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { roomId: ROOM_ID });
    });
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = (currentTool === 'pen') ? currentColor : '#FFFFFF';
    ctx.lineWidth = currentSize; ctx.stroke();
    socket.emit('drawing', { roomId: ROOM_ID, x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color: currentColor, size: currentSize, tool: currentTool });
    lastX = pos.x; lastY = pos.y;
}

socket.on('drawing', (data) => {
    ctx.beginPath(); ctx.moveTo(data.x0, data.y0); ctx.lineTo(data.x1, data.y1);
    ctx.strokeStyle = (data.tool === 'pen') ? data.color : '#FFFFFF';
    ctx.lineWidth = data.size; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
});
socket.on('canvasCleared', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

// --- 事件監聽 ---
function setupEventListeners() {
    els.guessForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = els.chatInput.value.trim();
        if (text) {
            socket.emit('guess', { roomId: ROOM_ID, text: text });
            els.chatInput.value = '';
        }
    });

    els.wordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const word = els.wordInput.value.trim();
        if (word && IS_DRAWER) {
            socket.emit('startRound', { roomId: ROOM_ID, word: word });
            els.wordModal.style.display = 'none';
            els.wordInput.value = '';
        }
    });

    document.querySelectorAll('.tool-button').forEach(btn => {
        if (!btn.dataset.tool) return;
        btn.addEventListener('click', (e) => {
            const tool = e.currentTarget.dataset.tool;
            if (tool) {
                currentTool = tool;
                document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
                if(tool==='eraser') document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));
                e.currentTarget.classList.add('active');
            }
        });
    });

    document.getElementById('sizeSlider').addEventListener('input', (e) => currentSize = parseInt(e.target.value));
    els.startRoundBtn.addEventListener('click', () => { if (IS_DRAWER) els.wordModal.style.display = 'block'; });
}

// --- Socket 狀態更新 ---

function updateScoreboard(scores, playerMap, currentDrawerSocketId) {
    els.playerList.innerHTML = '';
    const sortedPlayers = Object.values(playerMap)
        .sort((a, b) => (scores[b.userId] || 0) - (scores[a.userId] || 0));

    sortedPlayers.forEach(p => {
        const score = scores[p.userId] || 0;
        const isSelf = p.userId === USER_ID;
        const isDrawer = p.socketId === currentDrawerSocketId;
        const hasGuessed = p.hasGuessed; 
        
        const li = document.createElement('li');
        li.className = `player-item ${isSelf ? 'self' : ''} ${isDrawer ? 'drawer' : ''} ${hasGuessed ? 'guessed' : ''}`;
        li.innerHTML = `
            ${isDrawer ? '' : ''}
            <span class="player-name">${p.nickname}</span> 
            <span class="score">${score}</span>
        `;
        els.playerList.appendChild(li);
    });
}

function toggleDrawerControls(isDrawer) {
    IS_DRAWER = isDrawer;
    const controls = document.querySelectorAll('.tool-button:not(#startRoundButton), .size-slider, .color-swatch');
    controls.forEach(c => {
        const el = c; 
        if (el.classList.contains('color-swatch')) {
            el.style.pointerEvents = isDrawer ? 'auto' : 'none';
            el.style.opacity = isDrawer ? '1' : '0.5';
        } else {
            el.disabled = !isDrawer;
            el.style.opacity = isDrawer ? '1' : '0.5';
        }
    });
}

// ★★★ 接收時間更新：會移動計時條 ★★★
socket.on('timerUpdate', ({ timeLeft, total }) => {
    if (!els.timerBar) return;
    const percent = (timeLeft / total) * 100;
    els.timerBar.style.width = `${percent}%`;
    
    if (percent < 20) {
        els.timerBar.style.backgroundColor = 'var(--danger-red)';
    } else {
        els.timerBar.style.backgroundColor = 'var(--gartic-blue)';
    }
});

socket.on('playerListUpdate', ({ scores, playerMap, currentDrawerSocketId }) => {
    updateScoreboard(scores, playerMap, currentDrawerSocketId);
});

socket.on('chatMessage', ({ nickname, text, isSystem }) => {
    const p = document.createElement('p');
    p.className = `message ${isSystem ? 'system-message' : ''}`;
    if (isSystem) p.innerHTML = `<span class="system">${text}</span>`;
    else p.innerHTML = `<span class="user">${nickname}：</span>${text}`;
    els.messages.appendChild(p);
    els.messages.scrollTop = els.messages.scrollHeight;
});

socket.on('roundStarted', ({ drawerUserId, drawerNickname, wordLength }) => {
    els.gameStatus.textContent = `${drawerNickname} 正在作畫...`;
    els.currentWordDisplay.textContent = `提示：${wordLength} 個字`;
    if (String(drawerUserId) !== USER_ID) {
        toggleDrawerControls(false);
        els.startRoundBtn.style.display = 'none';
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('roundStartedForDrawer', ({ word }) => {
    els.gameStatus.textContent = `你的題目是：${word}`;
    els.currentWordDisplay.textContent = `✍️ 題目：${word}`;
    toggleDrawerControls(true);
    els.startRoundBtn.style.display = 'none'; 
});

socket.on('roundEnded', ({ winnerUserId, answer, reason }) => {
    els.gameStatus.textContent = reason ? `${reason} 答案：${answer}` : `答案揭曉：${answer}`;
    els.currentWordDisplay.textContent = '回合結束';
    
    toggleDrawerControls(false);
    els.startRoundBtn.style.display = 'none';
    
    if(els.timerBar) els.timerBar.style.width = '0%';
});

socket.on('nextDrawer', ({ drawerSocketId, drawerNickname }) => {
    const isMe = socket.id === drawerSocketId;
    els.gameStatus.textContent = isMe ? '輪到你了！請出題' : `請 ${drawerNickname} 出題`;
    els.currentWordDisplay.textContent = '準備中...';
    
    if(els.timerBar) {
        els.timerBar.style.width = '100%';
        els.timerBar.style.backgroundColor = 'var(--gartic-blue)';
    }

    if (isMe) {
        toggleDrawerControls(true);
        els.startRoundBtn.style.display = 'inline-block'; 
        els.wordModal.style.display = 'block';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
        toggleDrawerControls(false);
        els.startRoundBtn.style.display = 'none';
    }
});

document.addEventListener("DOMContentLoaded", initGame);