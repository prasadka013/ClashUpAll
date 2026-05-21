import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ClashUp Client Logic
window.__clashup3DReady = false;

const socket = window.io();

// UI Screen Elements
const menuScreen = document.getElementById('menu-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverOverlay = document.getElementById('game-over-overlay');

// Form Fields & inputs
const playerNameInput = document.getElementById('player-name');
const customColorInput = document.getElementById('custom-color');
const colorNodes = document.querySelectorAll('.color-node');
const roomCodeInput = document.getElementById('room-code-input');
const tabCreate = document.getElementById('tab-create');
const tabJoin = document.getElementById('tab-join');
const formCreate = document.getElementById('form-create');
const formJoin = document.getElementById('form-join');

// Lobby Elements
const playerList = document.getElementById('player-list');
const playerCountDisplay = document.getElementById('player-count');
const roomCodeDisplay = document.getElementById('room-code-display');
const btnReady = document.getElementById('btn-ready');
const btnAddBot = document.getElementById('btn-add-bot');
const btnStartGame = document.getElementById('btn-start-game');
const hostControls = document.getElementById('host-controls');

// Game Screen & HUD
const canvas = document.getElementById('gameCanvas');
const aimingCountdown = document.getElementById('aiming-countdown');
const countdownNumber = document.getElementById('countdown-number');
const hudAliveCount = document.getElementById('hud-alive-count');
const hudCodeText = document.getElementById('hud-code-text');
const hudPhaseText = document.getElementById('hud-phase-text');
const hudRoundText = document.getElementById('hud-round-text');
const hudStrikesText = document.getElementById('hud-strikes-text');
const hudStrikesWrap = document.getElementById('hud-strikes-wrap');
const hudRoundWrap = document.getElementById('hud-round-wrap');
const hudRoundBanner = document.getElementById('hud-round-banner');
const gameModeSelect = document.getElementById('game-mode-select');
const lobbyGameMode = document.getElementById('lobby-game-mode');
const lobbyModeTip = document.getElementById('lobby-mode-tip');
const hostModePicker = document.getElementById('host-mode-picker');
const aimingSubtext = document.getElementById('aiming-subtext');
const hudRoundLabel = document.getElementById('hud-round-label');
const hudRoundSub = document.getElementById('hud-round-sub');
const eliminationFeed = document.getElementById('elimination-feed');

// Modal Elements
const modalTitle = document.getElementById('modal-title');
const winnerCircle = document.getElementById('winner-circle');
const winnerName = document.getElementById('winner-name');
const winnerStats = document.getElementById('winner-stats');
const hostModalControls = document.getElementById('host-modal-controls');
const clientModalControls = document.getElementById('client-modal-controls');
const btnRestartMatch = document.getElementById('btn-restart-match');
const btnModalLobby = document.getElementById('btn-modal-lobby');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');

// Toast
const toast = document.getElementById('toast');

// Sound Visual Elements / Constants
const ARENA_CENTER = 400;
const ARENA_RADIUS = 300;
const PLAYER_RADIUS = 20;
const COLORS = {
  cyan: '#00f0ff',
  pink: '#ff2a5f',
  gold: '#ffcc00',
  white: '#ffffff',
  dark: '#06060a'
};

// Game State Management
let myId = null;
let currentRoom = null;
let chosenColor = '#00f0ff';
let activeScreen = 'menu';
let localPlayers = {}; // Cache of player states { id: player }
let currentPhase = 'LOBBY'; // LOBBY, AIMING, BATTLE, GAMEOVER

// Visual VFX Systems
let particles = [];
let explosions = [];
let driftTrails = {}; // Map player ID -> array of coordinates [{x, y}]

// Aim Input State
let isDraggingAim = false;
let lastAimSentTime = 0;
let aimAngle = 0;
let aimForce = 0.5;
let chosenGameMode = 'BAT_ARENA';
let serverBattleTicks = 0;
const moveKeys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
let lastMoveSentTime = 0;
let lastSwingSentTime = 0;
let spaceSwingHeld = false;

const MODE_TIPS = {
  BAT_ARENA: 'Bat Arena: free-for-all brawl. Swing your bat to knock pilots toward the ring — 3 ring touches eliminates them. Last one standing wins.',
  TOURNAMENT: 'Tournament mode: up to 6 pilots. Each round eliminates 2 until one champion remains. Add bots to fill the bracket.'
};

function isBatArenaMode(room = currentRoom) {
  return room && room.gameMode === 'BAT_ARENA';
}

function updateHudForMode(room) {
  const bat = isBatArenaMode(room);
  hudStrikesWrap.classList.toggle('hidden', !bat);
  hudRoundWrap.classList.toggle('hidden', bat);
  hudRoundBanner.classList.toggle('hidden', bat);
  if (bat) {
    hudPhaseText.innerText = room.gameState === 'AIMING' ? 'GET READY' : hudPhaseText.innerText;
  }
}

function syncBatArenaHud() {
  const me = localPlayers[myId];
  const maxStrikes = currentRoom?.borderStrikesToEliminate || 3;
  const strikes = me?.borderStrikes || 0;
  hudStrikesText.innerText = `${strikes}/${maxStrikes}`;
  const alive = Object.values(localPlayers).filter(p => p.isAlive).length;
  const total = Object.values(localPlayers).length;
  hudAliveCount.innerText = `${alive}/${total}`;
  hudRoundLabel.innerText = 'BAT ARENA';
  hudRoundSub.innerText = 'WASD move · Left-click or Space to swing';
  hudRoundBanner.classList.remove('hidden');
}

// Initialize Color Selector Nodes
colorNodes.forEach(node => {
  node.addEventListener('click', () => {
    colorNodes.forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    chosenColor = node.getAttribute('data-color');
    customColorInput.value = chosenColor;
  });
});

customColorInput.addEventListener('input', (e) => {
  colorNodes.forEach(n => n.classList.remove('active'));
  chosenColor = e.target.value;
});

// UI Menu Tabs Event Listeners
tabCreate.addEventListener('click', () => {
  tabCreate.classList.add('active');
  tabJoin.classList.remove('active');
  formCreate.classList.add('active');
  formJoin.classList.remove('active');
});

tabJoin.addEventListener('click', () => {
  tabJoin.classList.add('active');
  tabCreate.classList.remove('active');
  formJoin.classList.add('active');
  formCreate.classList.remove('active');
});

// Screen Transitions Helper
function showScreen(screenId) {
  menuScreen.classList.remove('active');
  lobbyScreen.classList.remove('active');
  gameScreen.classList.remove('active');
  
  if (screenId === 'menu') {
    menuScreen.classList.add('active');
    activeScreen = 'menu';
  } else if (screenId === 'lobby') {
    lobbyScreen.classList.add('active');
    activeScreen = 'lobby';
  } else if (screenId === 'game') {
    gameScreen.classList.add('active');
    activeScreen = 'game';
  }
}

// Show Alert Toast notifications
function showToast(message) {
  toast.innerText = message;
  toast.classList.remove('hidden');
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
    toast.classList.add('hidden');
  }, 4000);
}

// Format Name Helper (Capitalize first letter, fallback if blank)
function cleanPlayerName() {
  let name = playerNameInput.value.trim();
  if (!name) {
    const r = Math.floor(Math.random() * 9000) + 1000;
    name = `Roller #${r}`;
  }
  return name;
}

// Click to copy URL or Room Code
document.getElementById('btn-copy-code').addEventListener('click', () => {
  if (currentRoom) {
    const shareUrl = `${window.location.origin}?room=${currentRoom.code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Room link copied to clipboard!');
    }).catch(() => {
      navigator.clipboard.writeText(currentRoom.code);
      showToast('Room Code copied!');
    });
  }
});

// Auto-populate room code from URL query parameters if present
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCodeParam = urlParams.get('room');
  if (roomCodeParam) {
    tabJoin.click();
    roomCodeInput.value = roomCodeParam.toUpperCase().substring(0, 4);
    showToast(`Joining invite room: ${roomCodeParam.toUpperCase()}`);
  }
});

/* ==================== SOCKET INTERACTIONS ==================== */

// Create Room Action
if (gameModeSelect) {
  gameModeSelect.addEventListener('change', () => {
    chosenGameMode = gameModeSelect.value;
  });
}

if (lobbyGameMode) {
  lobbyGameMode.addEventListener('change', () => {
    if (currentRoom) {
      socket.emit('set_game_mode', { roomCode: currentRoom.code, gameMode: lobbyGameMode.value });
    }
  });
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  const name = cleanPlayerName();
  chosenGameMode = gameModeSelect ? gameModeSelect.value : 'BAT_ARENA';
  socket.emit('create_room', { playerName: name, playerColor: chosenColor, gameMode: chosenGameMode });
});

// Join Room Action
document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    showToast('Enter a valid 4-letter room code.');
    return;
  }
  const name = cleanPlayerName();
  socket.emit('join_room', { roomCode: code, playerName: name, playerColor: chosenColor });
});

// Leave Room Action
btnLeaveLobby.addEventListener('click', () => {
  window.location.href = window.location.origin; // Reload to cleanly reset socket & lobby
});

// Toggle Ready Action
btnReady.addEventListener('click', () => {
  if (currentRoom) {
    socket.emit('toggle_ready', { roomCode: currentRoom.code });
  }
});

// Host - Add Bot Action
btnAddBot.addEventListener('click', () => {
  if (currentRoom) {
    socket.emit('add_bot', { roomCode: currentRoom.code });
  }
});

// Host - Start Game Action
btnStartGame.addEventListener('click', () => {
  if (currentRoom) {
    socket.emit('start_match', { roomCode: currentRoom.code });
  }
});

// Host - Play Again Action
btnRestartMatch.addEventListener('click', () => {
  if (currentRoom) {
    socket.emit('restart_match', { roomCode: currentRoom.code });
  }
});

// Back to Lobby from Game Over Overlay
btnModalLobby.addEventListener('click', () => {
  gameOverOverlay.classList.remove('active');
  gameOverOverlay.classList.add('hidden');
  showScreen('lobby');
});

// Socket listeners
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('error_message', (msg) => {
  showToast(msg);
});

socket.on('room_created', (room) => {
  myId = socket.id;
  handleRoomUpdate(room);
  updateHudForMode(room);
  showScreen('lobby');
  showToast(room.gameMode === 'BAT_ARENA' ? 'Bat Arena room ready!' : 'Arena Initialized!');
});

socket.on('room_joined', (room) => {
  myId = socket.id;
  handleRoomUpdate(room);
  showScreen('lobby');
  showToast(`Joined Arena ${room.code}`);
});

socket.on('room_updated', (room) => {
  handleRoomUpdate(room);
});

function syncTournamentHud(room) {
  const round = room.tournamentRound || 1;
  const remaining = room.tournamentRemaining ?? Object.values(localPlayers).filter(p => p.inTournament !== false).length;
  const elimTarget = room.eliminationsNeeded || 2;
  hudRoundText.innerText = String(round);
  hudRoundLabel.innerText = `ROUND ${round}`;
  hudRoundSub.innerText = `${remaining} pilots · eliminate ${elimTarget}`;
  hudRoundBanner.classList.remove('hidden');
}

function updateLobbyModeUi(room) {
  const mode = room.gameMode || 'TOURNAMENT';
  if (lobbyModeTip) lobbyModeTip.innerText = MODE_TIPS[mode] || MODE_TIPS.TOURNAMENT;
  if (playerCountDisplay) {
    const maxP = mode === 'BAT_ARENA' ? 8 : 6;
    playerCountDisplay.innerText = room.players.length;
    const panelHeader = playerCountDisplay.closest('.panel-header');
    if (panelHeader) {
      panelHeader.querySelector('h3').innerHTML = `CONNECTED PLAYERS (<span id="player-count">${room.players.length}</span>/${maxP})`;
    }
  }

  const me = room.players.find(p => p.id === myId);
  if (me && me.isHost && hostModePicker && lobbyGameMode) {
    hostModePicker.classList.remove('hidden');
    lobbyGameMode.value = mode;
  } else if (hostModePicker) {
    hostModePicker.classList.add('hidden');
  }
}

socket.on('aiming_start', (room) => {
  currentPhase = 'AIMING';
  currentRoom = room;
  
  // Transition UI
  showScreen('game');
  gameOverOverlay.classList.remove('active');
  gameOverOverlay.classList.add('hidden');
  aimingCountdown.classList.remove('hidden');
  countdownNumber.innerText = room.countdown;

  // Sync HUD
  hudCodeText.innerText = `ROOM: ${room.code}`;
  hudPhaseText.innerText = isBatArenaMode(room) ? 'GET READY' : 'AIMING';
  hudPhaseText.className = 'hud-value neon-cyan';
  updateHudForMode(room);
  if (isBatArenaMode(room)) {
    syncBatArenaHud();
    if (aimingSubtext) aimingSubtext.innerText = 'Get ready — WASD to move, left-click or Space to swing';
  } else {
    syncTournamentHud(room);
    if (aimingSubtext) aimingSubtext.innerText = 'AIM WITH MOUSE OR TOUCH DRAG';
  }

  // Initialize client side players copy
  localPlayers = {};
  driftTrails = {};
  particles = [];
  explosions = [];
  eliminationFeed.innerHTML = '';

  room.players.forEach(p => {
    localPlayers[p.id] = p;
    driftTrails[p.id] = [];
  });

  updateAliveHUD();
});

socket.on('countdown_tick', ({ countdown }) => {
  countdownNumber.innerText = countdown;
});

socket.on('player_aim_updated', ({ id, angle, force }) => {
  if (localPlayers[id]) {
    localPlayers[id].angle = angle;
    localPlayers[id].force = force;
  }
});

socket.on('round_ended', ({ round, nextRound, eliminated, remaining, eliminationsNeeded, room }) => {
  currentRoom = room;
  currentPhase = 'INTERMISSION';
  hudPhaseText.innerText = 'NEXT ROUND';
  hudPhaseText.className = 'hud-value neon-gold';
  syncTournamentHud({ ...room, tournamentRound: nextRound, tournamentRemaining: remaining, eliminationsNeeded });

  if (eliminated.length) {
    addFeedItem(`${eliminated.join(', ')}`, COLORS.pink, `OUT — ${remaining} remain for Round ${nextRound}`);
  }
  showToast(`Round ${round} complete! ${remaining} pilots advance.`);
});

socket.on('battle_start', (room) => {
  currentPhase = 'BATTLE';
  currentRoom = room;
  aimingCountdown.classList.add('hidden');
  if (canvas && isBatArenaMode(room)) {
    canvas.setAttribute('tabindex', '0');
    canvas.focus();
  }

  hudPhaseText.innerText = 'BATTLE';
  hudPhaseText.className = 'hud-value neon-pink';
  if (isBatArenaMode(room)) syncBatArenaHud();
  else syncTournamentHud(room);

  // Apply final states from server
  room.players.forEach(p => {
    if (localPlayers[p.id]) {
      localPlayers[p.id].vx = p.vx;
      localPlayers[p.id].vy = p.vy;
      localPlayers[p.id].isAlive = p.isAlive;
    }
  });

  updateAliveHUD();
});

// Fast real-time Authoritative physics coordinates sync (60 FPS)
socket.on('physics_update', ({ players, collisions, battleTicks }) => {
  if (typeof battleTicks === 'number') serverBattleTicks = battleTicks;

  players.forEach(srvPlayer => {
    const clientPlayer = localPlayers[srvPlayer.id];
    if (clientPlayer) {
      clientPlayer.x = srvPlayer.x;
      clientPlayer.y = srvPlayer.y;
      clientPlayer.vx = srvPlayer.vx;
      clientPlayer.vy = srvPlayer.vy;
      if (typeof srvPlayer.facingAngle === 'number') {
        clientPlayer.facingAngle = srvPlayer.facingAngle;
        clientPlayer.angle = srvPlayer.facingAngle;
      }
      if (typeof srvPlayer.borderStrikes === 'number') clientPlayer.borderStrikes = srvPlayer.borderStrikes;
      if (typeof srvPlayer.swingActiveUntil === 'number') clientPlayer.swingActiveUntil = srvPlayer.swingActiveUntil;
      if (typeof srvPlayer.inTournament === 'boolean') {
        clientPlayer.inTournament = srvPlayer.inTournament;
      }

      if (clientPlayer.isAlive && !srvPlayer.isAlive) {
        clientPlayer.isAlive = false;
      }
    }
  });

  if (isBatArenaMode()) syncBatArenaHud();

  collisions.forEach(c => {
    spawnCollisionSparks(c.x, c.y, c.p1Color, c.p2Color, c.intensity);
  });
});

socket.on('bat_hit', ({ hits }) => {
  hits.forEach(h => {
    const victim = localPlayers[h.victimId];
    if (victim) spawnCollisionSparks(h.x, h.y, victim.color, COLORS.gold, 6);
    const attacker = localPlayers[h.attackerId];
    if (attacker && victim) {
      addFeedItem(attacker.name, attacker.color, `smacked <span style="color:${victim.color}">${victim.name}</span> toward the ring!`);
    }
    const view = playerViews.get(h.attackerId);
    if (view) triggerBatSwing(view);
  });
});

socket.on('border_strike', ({ id, name, color, strikes, maxStrikes }) => {
  if (localPlayers[id]) localPlayers[id].borderStrikes = strikes;
  addFeedItem(name, color, `touched the ring <span style="color:#ffcc00">${strikes}/${maxStrikes}</span>`);
  if (id === myId) syncBatArenaHud();
});

socket.on('bat_swing', ({ id, angle }) => {
  if (localPlayers[id]) {
    localPlayers[id].facingAngle = angle;
    localPlayers[id].angle = angle;
    const view = playerViews.get(id);
    if (view) triggerBatSwing(view);
  }
});

socket.on('player_eliminated', ({ id, name, color, x, y, reason }) => {
  if (localPlayers[id]) {
    localPlayers[id].isAlive = false;
  }

  spawnBoundaryShockwave(x, y, color);

  const detail = reason === 'strikes'
    ? 'took <span style="color: #ff2a5f; font-weight: 800;">3 RING STRIKES</span> & was eliminated'
    : 'crossed boundary & was <span style="color: #ff2a5f; font-weight: 800;">ELIMINATED</span>';
  addFeedItem(name, color, detail);

  if (isBatArenaMode()) syncBatArenaHud();
  else updateAliveHUD();
});

socket.on('match_ended', ({ winner, room, stats }) => {
  currentPhase = 'GAMEOVER';
  currentRoom = room;
  hudPhaseText.innerText = 'CHAMPION';
  hudPhaseText.className = 'hud-value neon-cyan';
  hudRoundBanner.classList.add('hidden');
  
  // Update scores in lobby data
  room.players.forEach(p => {
    if (localPlayers[p.id]) {
      localPlayers[p.id].score = p.score;
    }
  });

  setTimeout(() => {
    displayGameOver(winner, stats);
  }, 1000); // 1-second delay for players to appreciate the final drifts/debris
});

socket.on('match_restarted', (room) => {
  currentPhase = 'LOBBY';
  gameOverOverlay.classList.remove('active');
  gameOverOverlay.classList.add('hidden');
  handleRoomUpdate(room);
  showScreen('lobby');
});

// Update Lobby screen states
function handleRoomUpdate(room) {
  currentRoom = room;
  updateLobbyModeUi(room);

  // Update Room Display
  roomCodeDisplay.innerText = room.code;

  // Clear listing
  playerList.innerHTML = '';

  let me = null;
  let allHumansReady = true;

  room.players.forEach(p => {
    if (p.id === myId) me = p;
    if (!p.isBot && !p.isHost && !p.isReady) {
      allHumansReady = false;
    }

    const card = document.createElement('div');
    card.className = 'player-card';

    // Left elements
    const left = document.createElement('div');
    left.className = 'player-card-left';

    const avatar = document.createElement('span');
    avatar.className = 'player-avatar-circle';
    avatar.style.color = p.color;
    avatar.style.backgroundColor = p.color;

    const meta = document.createElement('div');
    meta.className = 'player-meta';

    const name = document.createElement('span');
    name.className = 'player-name-text';
    name.innerText = p.name;
    if (p.isHost) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'host-badge';
      hostBadge.innerText = 'Host';
      name.appendChild(hostBadge);
    }
    if (p.id === myId) {
      name.style.color = '#fff';
      name.style.fontWeight = '800';
    }

    const score = document.createElement('span');
    score.className = 'score-badge';
    score.innerHTML = `Victories: <span>${p.score}</span>`;

    meta.appendChild(name);
    meta.appendChild(score);
    left.appendChild(avatar);
    left.appendChild(meta);

    // Right elements
    const right = document.createElement('div');
    right.className = 'player-card-right';

    if (p.isBot) {
      const botBadge = document.createElement('span');
      botBadge.className = 'ready-badge ready';
      botBadge.innerText = 'AI BOT';
      right.appendChild(botBadge);

      // Kick bot option for host
      if (me && me.isHost) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick-bot';
        kickBtn.innerHTML = '&times;';
        kickBtn.title = 'Remove Bot';
        kickBtn.addEventListener('click', () => {
          socket.emit('remove_bot', { roomCode: room.code, botId: p.id });
        });
        right.appendChild(kickBtn);
      }
    } else {
      const readyBadge = document.createElement('span');
      readyBadge.className = `ready-badge ${p.isReady || p.isHost ? 'ready' : 'not-ready'}`;
      readyBadge.innerText = p.isHost ? 'HOST' : (p.isReady ? 'READY' : 'NOT READY');
      right.appendChild(readyBadge);
    }

    card.appendChild(left);
    card.appendChild(right);
    playerList.appendChild(card);
  });

  // Host specific UI controls
  if (me && me.isHost) {
    hostControls.classList.remove('hidden');
    
    // Start game button activation criteria:
    // 1. Minimum 2 players/bots present
    // 2. All active non-host human players must be ready
    const hasEnoughPlayers = room.players.length >= 2;
    
    if (hasEnoughPlayers && allHumansReady) {
      btnStartGame.classList.remove('btn-disabled');
      btnStartGame.disabled = false;
    } else {
      btnStartGame.classList.add('btn-disabled');
      btnStartGame.disabled = true;
    }

    btnStartGame.innerText = room.gameMode === 'BAT_ARENA'
      ? 'START BAT ARENA BRAWL'
      : 'ENGAGE LAUNCH SEQUENCE';
  } else {
    hostControls.classList.add('hidden');
  }

  // Update ready button toggle text
  if (me) {
    if (me.isHost) {
      btnReady.classList.add('hidden');
    } else {
      btnReady.classList.remove('hidden');
      btnReady.innerText = me.isReady ? 'UNREADY PILOT' : 'READY PILOT';
      btnReady.className = me.isReady ? 'btn btn-secondary' : 'btn btn-accent pulse-hover';
    }
  }
}

// Display game-over screen overlay modal
function displayGameOver(winner, stats = {}) {
  gameOverOverlay.classList.remove('hidden');
  gameOverOverlay.classList.add('active');

  if (winner) {
    modalTitle.innerText = 'CHAMPION DECLARED';
    modalTitle.style.color = COLORS.gold;
    winnerCircle.style.backgroundColor = winner.color;
    winnerCircle.style.color = winner.color;
    winnerCircle.classList.remove('hidden');
    winnerName.innerText = winner.name;
    winnerStats.innerText = `Collisions: ${stats.collisions || 0} | Max speed: ${(stats.maxSpeed || 0).toFixed(1)} | Top knockouts: ${stats.knockouts || 0}`;
  } else {
    modalTitle.innerText = 'MUTUAL DESTRUCTION';
    modalTitle.style.color = COLORS.pink;
    winnerCircle.classList.add('hidden');
    winnerName.innerText = 'NO SURVIVORS';
    winnerStats.innerText = `All pilots were eliminated. Collisions: ${stats.collisions || 0}`;
  }

  // Host vs client modal button displays
  const me = currentRoom ? currentRoom.players.find(p => p.id === myId) : null;
  if (me && me.isHost) {
    hostModalControls.classList.remove('hidden');
    clientModalControls.classList.add('hidden');
  } else {
    hostModalControls.classList.add('hidden');
    clientModalControls.classList.remove('hidden');
  }
}

function updateAliveHUD() {
  if (!currentRoom) return;
  const tournament = Object.values(localPlayers).filter(p => p.inTournament !== false);
  const alive = tournament.filter(p => p.isAlive).length;
  hudAliveCount.innerText = `${alive}/${tournament.length}`;
}

function addFeedItem(name, color, message) {
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.style.borderColor = color;
  const detail = message || 'crossed boundary & was <span style="color: #ff2a5f; font-weight: 800;">ELIMINATED</span>';
  item.innerHTML = `<span style="color: ${color}; font-weight: 800;">${name}</span> ${detail}`;
  
  eliminationFeed.appendChild(item);
  
  // Auto scroll/cleanup older logs
  if (eliminationFeed.children.length > 4) {
    eliminationFeed.removeChild(eliminationFeed.firstChild);
  }
}

/* ==================== 3D INPUTS AND RENDERING ==================== */

const MODEL_URL = '/models/RobotExpressive.glb';
const WORLD_Y = 0;

let scene;
let camera;
let renderer;
let raycaster;
let arenaPlane;
let cameraYaw = -0.62;
let cameraPitch = 0.92;
let cameraDistance = 730;
let targetCameraYaw = cameraYaw;
let targetCameraPitch = cameraPitch;
let targetCameraDistance = cameraDistance;
let cameraFocus = new THREE.Vector3(0, 0, 0);
let playerViews = new Map();
let robotModel = null;
let robotAnimations = [];
let isOrbitingCamera = false;
let lastPointer = null;
let clock = new THREE.Clock();

function serverToWorld(x, y) {
  return new THREE.Vector3(x - ARENA_CENTER, WORLD_Y, y - ARENA_CENTER);
}

function worldToServer(point) {
  return {
    x: point.x + ARENA_CENTER,
    y: point.z + ARENA_CENTER
  };
}

function initThreeScene() {
  window.__clashup3DReady = true;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8f0);
  scene.fog = new THREE.Fog(0x9ad4f5, 700, 1500);

  camera = new THREE.PerspectiveCamera(44, 1, 1, 2400);
  raycaster = new THREE.Raycaster();
  arenaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x6a8fb5, 1.5));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-200, 480, 220);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xa8ddff, 3200, 900);
  rimLight.position.set(280, 180, -220);
  scene.add(rimLight);

  buildIceArena();
  resizeThree();
  fitArenaToView();
  cameraDistance = targetCameraDistance;
  loadRobotModel();
  requestAnimationFrame(render3D);
}

function buildIceArena() {
  const iceFloorMat = new THREE.MeshStandardMaterial({
    color: 0xb8e8ff,
    metalness: 0.15,
    roughness: 0.22,
    emissive: 0x4a90c8,
    emissiveIntensity: 0.08,
    side: THREE.DoubleSide
  });

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 18, 160), iceFloorMat);
  floor.position.y = -10;
  scene.add(floor);

  const grid = new THREE.GridHelper(ARENA_RADIUS * 2, 24, 0x7ec8e8, 0x9ed4f0);
  grid.position.y = 1;
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  const spawnGlow = new THREE.Mesh(
    new THREE.TorusGeometry(42, 3, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.55 })
  );
  spawnGlow.rotation.x = Math.PI / 2;
  spawnGlow.position.y = 4;
  scene.add(spawnGlow);

  for (let radius = 100; radius <= ARENA_RADIUS; radius += 100) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, radius === ARENA_RADIUS ? 5 : 1.2, 12, 180),
      new THREE.MeshBasicMaterial({
        color: radius === ARENA_RADIUS ? 0x88ddff : 0xc8ecff,
        transparent: true,
        opacity: radius === ARENA_RADIUS ? 0.95 : 0.28
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = radius === ARENA_RADIUS ? 10 : 3;
    scene.add(ring);
  }

  const edgeRing = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS + 5, 3, 10, 180),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  );
  edgeRing.rotation.x = Math.PI / 2;
  edgeRing.position.y = 12;
  scene.add(edgeRing);

  const iceWallMat = new THREE.MeshStandardMaterial({
    color: 0xe8f8ff,
    metalness: 0.05,
    roughness: 0.35,
    transparent: true,
    opacity: 0.88
  });
  const wallCount = 28;
  for (let i = 0; i < wallCount; i++) {
    const angle = (i / wallCount) * Math.PI * 2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(36, 28, 36), iceWallMat);
    block.position.set(
      Math.cos(angle) * (ARENA_RADIUS + 52),
      12,
      Math.sin(angle) * (ARENA_RADIUS + 52)
    );
    block.rotation.y = -angle;
    scene.add(block);
  }

  const mountainMat = new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.9, metalness: 0 });
  const mountainShadow = new THREE.MeshStandardMaterial({ color: 0xc5d8ea, roughness: 0.95 });
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.2;
    const dist = ARENA_RADIUS + 180 + (i % 3) * 40;
    const base = new THREE.Mesh(new THREE.ConeGeometry(90 + (i % 4) * 20, 120 + (i % 3) * 30, 5), i % 2 ? mountainMat : mountainShadow);
    base.position.set(Math.cos(angle) * dist, 40, Math.sin(angle) * dist);
    base.rotation.y = angle;
    scene.add(base);
  }

  const waterPlane = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS + 220, 64),
    new THREE.MeshStandardMaterial({ color: 0x5eb8e8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 })
  );
  waterPlane.rotation.x = -Math.PI / 2;
  waterPlane.position.y = -18;
  scene.add(waterPlane);
}

function loadRobotModel() {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      robotModel = gltf.scene;
      robotAnimations = gltf.animations || [];
      playerViews.forEach((view, id) => {
        const player = localPlayers[id];
        if (player) {
          replaceBotBody(view, player);
        }
      });
      showToast('3D bot model loaded.');
    },
    undefined,
    () => {
      showToast('Using built-in 3D bots while model CDN loads slowly.');
    }
  );
}

function createPlayerView(player) {
  const group = new THREE.Group();
  const baseColor = new THREE.Color(player.color);

  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(PLAYER_RADIUS * 1.05, 2.4, 10, 48),
    new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.85 })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 5;
  group.add(halo);

  const aimArrow = createAimArrow(player.color);
  group.add(aimArrow);

  const bat = createBatMesh(player.color);
  group.add(bat);

  const label = createNameSprite(player.name, player.color, player.id === myId);
  label.position.y = 78;
  group.add(label);

  const trailGeometry = new THREE.BufferGeometry();
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: 0.48 })
  );
  trail.position.y = 5;
  scene.add(trail);

  const view = {
    group,
    bodyRoot,
    halo,
    aimArrow,
    bat,
    batSwing: 0,
    label,
    trail,
    trailPoints: [],
    mixer: null,
    modelLoaded: false
  };

  replaceBotBody(view, player);
  scene.add(group);
  playerViews.set(player.id, view);
  return view;
}

function replaceBotBody(view, player) {
  view.bodyRoot.clear();
  view.mixer = null;
  view.modelLoaded = Boolean(robotModel);

  if (robotModel) {
    const bot = SkeletonUtils.clone(robotModel);
    bot.scale.setScalar(11.5);
    bot.position.y = 6;
    bot.rotation.y = Math.PI;
    tintModel(bot, player.color);
    view.bodyRoot.add(bot);

    if (robotAnimations.length) {
      view.mixer = new THREE.AnimationMixer(bot);
      const clip = robotAnimations[Math.floor(Math.random() * robotAnimations.length)];
      const action = view.mixer.clipAction(clip);
      action.timeScale = 0.75 + Math.random() * 0.45;
      action.play();
    }
    return;
  }

  const color = new THREE.Color(player.color);
  const shellMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    metalness: 0.68,
    roughness: 0.24
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x080910,
    metalness: 0.5,
    roughness: 0.32
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(14, 24, 8, 18), shellMaterial);
  body.position.y = 32;
  view.bodyRoot.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 16), darkMaterial);
  head.position.y = 57;
  view.bodyRoot.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 4), shellMaterial);
  visor.position.set(0, 58, 11);
  view.bodyRoot.add(visor);
}

function tintModel(root, color) {
  const tint = new THREE.Color(color);
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.material = child.material.clone();
    child.material.metalness = Math.max(child.material.metalness || 0, 0.25);
    child.material.roughness = Math.min(child.material.roughness || 0.45, 0.55);
    child.material.emissive = tint.clone();
    child.material.emissiveIntensity = 0.08;
  });
}

function createBatMesh(color) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xc68642, metalness: 0.2, roughness: 0.55 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a1810, metalness: 0.1, roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.35
  });

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 18, 10), grip);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -9;
  group.add(handle);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.4, 42, 12), wood);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 12;
  group.add(barrel);

  const band = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.6, 8, 16), accent);
  band.rotation.y = Math.PI / 2;
  band.position.z = 4;
  group.add(band);

  group.position.set(PLAYER_RADIUS + 8, 28, 0);
  group.rotation.y = Math.PI / 2;
  group.visible = false;
  return group;
}

function triggerBatSwing(view) {
  view.batSwing = 1;
}

function createAimArrow(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.92 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 1, 12), material);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(8, 18, 18), material);
  head.rotation.x = Math.PI / 2;
  head.position.z = 1;
  group.add(shaft, head);
  group.visible = false;
  group.userData = { shaft, head, material };
  return group;
}

function createNameSprite(name, color, isMe) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const labelCtx = labelCanvas.getContext('2d');
  labelCtx.fillStyle = 'rgba(5, 5, 10, 0.72)';
  roundRect(labelCtx, 8, 10, 240, 42, 12);
  labelCtx.fill();
  labelCtx.strokeStyle = color;
  labelCtx.lineWidth = isMe ? 3 : 1.5;
  labelCtx.stroke();
  labelCtx.font = '700 20px Inter, Arial, sans-serif';
  labelCtx.textAlign = 'center';
  labelCtx.textBaseline = 'middle';
  labelCtx.fillStyle = isMe ? COLORS.cyan : COLORS.white;
  labelCtx.fillText(name.slice(0, 18), 128, 31);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(96, 24, 1);
  return sprite;
}

function roundRect(target, x, y, width, height, radius) {
  target.beginPath();
  target.moveTo(x + radius, y);
  target.arcTo(x + width, y, x + width, y + height, radius);
  target.arcTo(x + width, y + height, x, y + height, radius);
  target.arcTo(x, y + height, x, y, radius);
  target.arcTo(x, y, x + width, y, radius);
  target.closePath();
}

function updatePlayerViews(delta) {
  const ids = new Set(Object.keys(localPlayers));
  playerViews.forEach((view, id) => {
    if (!ids.has(id)) {
      scene.remove(view.group);
      scene.remove(view.trail);
      playerViews.delete(id);
    }
  });

  Object.values(localPlayers).forEach((player) => {
    const view = playerViews.get(player.id) || createPlayerView(player);
    if (robotModel && !view.modelLoaded) {
      replaceBotBody(view, player);
    }

    const pos = serverToWorld(player.x, player.y);
    const inTournament = player.inTournament !== false;
    view.group.position.lerp(new THREE.Vector3(pos.x, 0, pos.z), currentPhase === 'BATTLE' ? 0.58 : 1);
    view.group.visible = inTournament;
    view.group.scale.setScalar(inTournament && player.isAlive ? 1 : 0.55);
    view.halo.material.opacity = player.isAlive ? 0.72 + Math.sin(performance.now() * 0.006) * 0.13 : 0.16;

    const speed = Math.hypot(player.vx || 0, player.vy || 0);
    const faceAngle = typeof player.facingAngle === 'number'
      ? player.facingAngle
      : (speed > 0.15 ? Math.atan2(player.vy, player.vx) : player.angle);
    view.group.rotation.y = Math.PI / 2 - faceAngle;

    const batMode = isBatArenaMode();
    view.bat.visible = batMode && player.isAlive && inTournament;
    view.aimArrow.visible = !batMode && currentPhase === 'AIMING' && player.isAlive;

    if (view.bat.visible) {
      const swingT = view.batSwing;
      if (swingT > 0) {
        view.bat.rotation.z = -Math.sin(swingT * Math.PI) * 1.65;
        view.batSwing = Math.max(0, swingT - delta * 6.5);
      } else {
        view.bat.rotation.z *= 0.82;
      }
      view.bat.rotation.y = Math.PI / 2;
    }

    view.halo.material.color.set(new THREE.Color(player.color));

    if (view.mixer) {
      view.mixer.update(delta * (player.isAlive ? 1 + Math.min(speed / 12, 0.7) : 0.25));
    }

    updateAimArrow(view, player);
    updateTrail(view, player, pos);
  });
}

function updateAimArrow(view, player) {
  const arrow = view.aimArrow;
  arrow.visible = currentPhase === 'AIMING' && player.isAlive;
  if (!arrow.visible) return;

  const forceColor = player.force > 0.7 ? COLORS.pink : player.force > 0.35 ? COLORS.gold : COLORS.cyan;
  arrow.userData.material.color.set(forceColor);
  arrow.position.set(0, 22, 0);

  const length = 48 + player.force * 130;
  arrow.userData.shaft.scale.set(1, length, 1);
  arrow.userData.shaft.position.z = length / 2;
  arrow.userData.head.position.z = length + 8;

  view.group.updateWorldMatrix(true, false);
  const worldPos = new THREE.Vector3();
  arrow.getWorldPosition(worldPos);
  const target = new THREE.Vector3(
    worldPos.x + Math.cos(player.angle),
    worldPos.y,
    worldPos.z + Math.sin(player.angle)
  );
  arrow.lookAt(target);
}

function updateTrail(view, player, pos) {
  if (currentPhase === 'BATTLE' && player.isAlive && Math.hypot(player.vx || 0, player.vy || 0) > 0.2) {
    view.trailPoints.push(new THREE.Vector3(pos.x, 6, pos.z));
    if (view.trailPoints.length > 24) {
      view.trailPoints.shift();
    }
  }

  if (currentPhase !== 'BATTLE' || !player.isAlive) {
    view.trailPoints.shift();
  }

  if (view.trailPoints.length > 1) {
    view.trail.geometry.setFromPoints(view.trailPoints);
    view.trail.visible = true;
  } else {
    view.trail.visible = false;
  }
}

function updateCamera() {
  const me = localPlayers[myId];
  if (currentPhase === 'BATTLE' && me && me.isAlive && !isOrbitingCamera) {
    const pos = serverToWorld(me.x, me.y);
    cameraFocus.lerp(new THREE.Vector3(pos.x, 0, pos.z), 0.035);
  } else {
    cameraFocus.lerp(new THREE.Vector3(0, 0, 0), 0.025);
  }

  cameraYaw += (targetCameraYaw - cameraYaw) * 0.12;
  cameraPitch += (targetCameraPitch - cameraPitch) * 0.12;
  cameraDistance += (targetCameraDistance - cameraDistance) * 0.1;

  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  camera.position.set(
    cameraFocus.x + Math.sin(cameraYaw) * horizontal,
    cameraFocus.y + Math.sin(cameraPitch) * cameraDistance,
    cameraFocus.z + Math.cos(cameraYaw) * horizontal
  );
  camera.lookAt(cameraFocus.x, cameraFocus.y + 18, cameraFocus.z);
}

function updateEffects() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.mesh.position.add(p.velocity);
    p.velocity.multiplyScalar(0.94);
    p.velocity.y -= 0.035;
    p.life -= p.decay;
    p.mesh.material.opacity = Math.max(0, p.life);
    p.mesh.scale.multiplyScalar(0.985);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }

  for (let i = explosions.length - 1; i >= 0; i--) {
    const exp = explosions[i];
    exp.radius += 8;
    exp.life -= 0.035;
    exp.mesh.scale.setScalar(exp.radius / 10);
    exp.mesh.material.opacity = Math.max(0, exp.life);
    if (exp.life <= 0) {
      scene.remove(exp.mesh);
      explosions.splice(i, 1);
    }
  }
}

function getMoveVector() {
  let dx = 0;
  let dy = 0;
  if (moveKeys.w || moveKeys.ArrowUp) dy -= 1;
  if (moveKeys.s || moveKeys.ArrowDown) dy += 1;
  if (moveKeys.a || moveKeys.ArrowLeft) dx -= 1;
  if (moveKeys.d || moveKeys.ArrowRight) dx += 1;
  return { dx, dy };
}

function sendBatArenaInput() {
  if (!currentRoom || currentPhase !== 'BATTLE' || !isBatArenaMode()) return;
  const me = localPlayers[myId];
  if (!me || !me.isAlive) return;

  const { dx, dy } = getMoveVector();
  const now = Date.now();
  if (now - lastMoveSentTime < 33) return;
  lastMoveSentTime = now;

  let facingAngle = me.facingAngle ?? me.angle ?? 0;
  if (Math.hypot(dx, dy) > 0.01) {
    facingAngle = Math.atan2(dy, dx);
    me.facingAngle = facingAngle;
    me.angle = facingAngle;
  }

  socket.emit('player_move', {
    roomCode: currentRoom.code,
    dx,
    dy,
    facingAngle
  });
}

function tryBatSwing(worldPoint) {
  if (activeScreen !== 'game' || !currentRoom || currentPhase !== 'BATTLE' || !isBatArenaMode()) return false;
  const me = localPlayers[myId];
  if (!me || !me.isAlive) return false;

  const now = Date.now();
  if (now - lastSwingSentTime < 180) return false;
  lastSwingSentTime = now;

  let angle = me.facingAngle ?? me.angle ?? 0;
  if (worldPoint) {
    const serverPoint = worldToServer(worldPoint);
    const dx = serverPoint.x - me.x;
    const dy = serverPoint.y - me.y;
    if (Math.hypot(dx, dy) > 8) {
      angle = Math.atan2(dy, dx);
    }
  }

  me.facingAngle = angle;
  me.angle = angle;
  const view = playerViews.get(myId);
  if (view) triggerBatSwing(view);

  socket.emit('bat_swing', { roomCode: currentRoom.code, angle });
  return true;
}

function handleBatSwingKey(down) {
  if (down) {
    if (!spaceSwingHeld) tryBatSwing(null);
    spaceSwingHeld = true;
  } else {
    spaceSwingHeld = false;
  }
}

function render3D() {
  requestAnimationFrame(render3D);
  const delta = clock.getDelta();
  resizeThree();
  sendBatArenaInput();
  updateCamera();
  updatePlayerViews(delta);
  updateEffects();
  renderer.render(scene, camera);
}

function fitArenaToView() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const aspect = width / height;
  const vFovRad = (camera.fov * Math.PI) / 180;
  const arenaSpan = ARENA_RADIUS * 2.15;
  const distForHeight = (arenaSpan / 2) / Math.tan(vFovRad / 2);
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  const distForWidth = (arenaSpan / 2) / Math.tan(hFovRad / 2);
  const pitch = Math.max(0.35, targetCameraPitch);
  const fitted = Math.max(distForHeight, distForWidth) / Math.sin(pitch) * 1.06;
  targetCameraDistance = Math.max(480, Math.min(1050, fitted));
}

function resizeThree() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitArenaToView();
  }
}

function pointerFromEvent(e) {
  const touch = e.touches ? e.touches[0] : e;
  return { x: touch.clientX, y: touch.clientY };
}

function pointerNdc(e) {
  const point = pointerFromEvent(e);
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((point.x - rect.left) / rect.width) * 2 - 1,
    -(((point.y - rect.top) / rect.height) * 2 - 1)
  );
}

function arenaPointFromPointer(e) {
  raycaster.setFromCamera(pointerNdc(e), camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(arenaPlane, hit)) {
    return null;
  }
  return hit;
}

function projectedPlayerDistance(player, eventPoint) {
  const world = serverToWorld(player.x, player.y);
  world.y = 34;
  world.project(camera);
  const rect = canvas.getBoundingClientRect();
  const sx = (world.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-world.y * 0.5 + 0.5) * rect.height + rect.top;
  return Math.hypot(eventPoint.x - sx, eventPoint.y - sy);
}

function startAimDrag(e) {
  const point = pointerFromEvent(e);
  const me = localPlayers[myId];
  const isLeftClick = e.button === undefined || e.button === 0;

  if (currentPhase === 'BATTLE' && isBatArenaMode() && me && me.isAlive && isLeftClick) {
    e.preventDefault();
    const hit = arenaPointFromPointer(e);
    tryBatSwing(hit);
    return;
  }

  if (currentPhase === 'AIMING' && !isBatArenaMode() && me && me.isAlive && projectedPlayerDistance(me, point) < 95) {
    isDraggingAim = true;
    updateAimVector(e);
    return;
  }

  isOrbitingCamera = true;
  lastPointer = point;
}

function continueAimDrag(e) {
  if (isDraggingAim && currentPhase === 'AIMING') {
    updateAimVector(e);
    return;
  }

  if (!isOrbitingCamera || !lastPointer) return;
  const point = pointerFromEvent(e);
  const dx = point.x - lastPointer.x;
  const dy = point.y - lastPointer.y;
  targetCameraYaw -= dx * 0.008;
  targetCameraPitch = Math.max(0.48, Math.min(1.24, targetCameraPitch + dy * 0.004));
  lastPointer = point;
}

function endAimDrag() {
  isDraggingAim = false;
  isOrbitingCamera = false;
  lastPointer = null;
}

function updateAimVector(e) {
  const me = localPlayers[myId];
  if (!me || !me.isAlive || !currentRoom) return;

  const hit = arenaPointFromPointer(e);
  const serverPoint = worldToServer(hit);
  const dx = serverPoint.x - me.x;
  const dy = serverPoint.y - me.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const force = Math.max(0.08, Math.min(1, dist / 170));

  aimAngle = angle;
  aimForce = force;
  me.angle = angle;
  me.force = force;

  const now = Date.now();
  if (now - lastAimSentTime > 30) {
    socket.emit('set_aim', {
      roomCode: currentRoom.code,
      angle,
      force
    });
    lastAimSentTime = now;
  }
}

canvas.addEventListener('mousedown', startAimDrag);
window.addEventListener('mousemove', continueAimDrag);
window.addEventListener('mouseup', endAimDrag);

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startAimDrag(e);
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (isDraggingAim || isOrbitingCamera) e.preventDefault();
  continueAimDrag(e);
}, { passive: false });
window.addEventListener('touchend', endAimDrag);
function onGameKeyDown(e) {
  if (activeScreen !== 'game') return;

  if (moveKeys[e.key] !== undefined) {
    moveKeys[e.key] = true;
    e.preventDefault();
  }

  if (e.code === 'Space' && currentPhase === 'BATTLE' && isBatArenaMode()) {
    e.preventDefault();
    handleBatSwingKey(true);
  }
}

function onGameKeyUp(e) {
  if (moveKeys[e.key] !== undefined) {
    moveKeys[e.key] = false;
    e.preventDefault();
  }
  if (e.code === 'Space') {
    spaceSwingHeld = false;
  }
}

document.addEventListener('keydown', onGameKeyDown);
document.addEventListener('keyup', onGameKeyUp);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  targetCameraDistance = Math.max(470, Math.min(960, targetCameraDistance + e.deltaY * 0.5));
}, { passive: false });

function spawnCollisionSparks(x, y, color1, color2, intensity) {
  const origin = serverToWorld(x, y);
  const count = Math.min(26, Math.floor(10 + intensity * 2.4));

  for (let i = 0; i < count; i++) {
    const color = Math.random() > 0.5 ? color1 : color2;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(2 + Math.random() * 2.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 1 })
    );
    mesh.position.set(origin.x, 22 + Math.random() * 18, origin.z);
    scene.add(mesh);

    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * (1.5 + intensity * 0.22);
    particles.push({
      mesh,
      velocity: new THREE.Vector3(Math.cos(angle) * speed, 1.6 + Math.random() * 2.2, Math.sin(angle) * speed),
      life: 1,
      decay: 0.025 + Math.random() * 0.025
    });
  }
}

function spawnBoundaryShockwave(x, y, color) {
  const origin = serverToWorld(x, y);
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(10, 2.3, 8, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.95 })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(origin.x, 18, origin.z);
  scene.add(mesh);
  explosions.push({ mesh, radius: 10, life: 1 });

  for (let i = 0; i < 24; i++) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(2.5 + Math.random() * 2, 8, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 1 })
    );
    spark.position.set(origin.x, 20, origin.z);
    scene.add(spark);
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    particles.push({
      mesh: spark,
      velocity: new THREE.Vector3(Math.cos(angle) * speed, 2 + Math.random() * 3, Math.sin(angle) * speed),
      life: 1,
      decay: 0.018 + Math.random() * 0.02
    });
  }
}

initThreeScene();
