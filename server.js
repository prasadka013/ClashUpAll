const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

// Fallback to serve index.html for any request
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game Configurations
const ARENA_X = 400;
const ARENA_Y = 400;
const ARENA_RADIUS = 300;
const PLAYER_RADIUS = 20;
const SPAWN_RADIUS = 120; // Radius of circle where players spawn in the center
const BASE_MAX_VELOCITY = 15; // Max speed for maximum launch force
const FRICTION = 0.985; // Damping factor per physics tick
const BOUNCE_RESTITUTION = 1.15; // Restitution coefficient (elasticity > 1.0 for high energy collisions!)

// Rooms state store
// Room Code -> { code, players: { socketId: playerState }, gameState: 'LOBBY'|'AIMING'|'BATTLE'|'GAMEOVER', countdown, timerId, physicsIntervalId, battleTicks }
const rooms = {};

// Helper to generate a random 4-letter room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

// Bot Names List
const BOT_NAMES = ['BumperBot', 'SlamMaster', 'CurlingKing', 'DriftDroid', 'BouncyBoy', 'ApexPusher', 'TurboAI', 'Orbiteer'];
const BOT_COLORS = ['#ff2a5f', '#00f0ff', '#39ff14', '#ffcc00', '#8a2be2', '#ff5722', '#e91e63', '#00bcd4'];

// Helper to get room state clean of socket instances for sending to client
function getRoomPayload(room) {
  if (!room) return null;
  return {
    code: room.code,
    gameState: room.gameState,
    countdown: room.countdown,
    stats: room.stats,
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isReady: p.isReady,
      isHost: p.isHost,
      isBot: p.isBot,
      isAlive: p.isAlive,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      angle: p.angle,
      force: p.force,
      score: p.score
    }))
  };
}

// Broadcast room update to all clients in a room
function broadcastRoomUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('room_updated', getRoomPayload(room));
}

// Start physics loop for a room in active battle phase
function startPhysicsLoop(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // Clear any existing physics loops
  if (room.physicsIntervalId) {
    clearInterval(room.physicsIntervalId);
  }

  // Set initial launch velocities for all players based on their chosen angle & force
  Object.values(room.players).forEach(player => {
    if (player.isAlive) {
      // Force is normalized 0 to 1
      player.vx = Math.cos(player.angle) * player.force * BASE_MAX_VELOCITY;
      player.vy = Math.sin(player.angle) * player.force * BASE_MAX_VELOCITY;
      player.maxSpeed = Math.max(player.maxSpeed || 0, Math.hypot(player.vx, player.vy));
    }
  });

  io.to(roomCode).emit('battle_start', getRoomPayload(room));

  // Run at 60 ticks per second (~16.67ms)
  room.physicsIntervalId = setInterval(() => {
    updatePhysics(roomCode);
  }, 1000 / 60);
}

// Authoritative Physics Loop
function updatePhysics(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.gameState !== 'BATTLE') return;

  const players = Object.values(room.players);
  const alivePlayers = players.filter(p => p.isAlive);
  room.battleTicks = (room.battleTicks || 0) + 1;

  // 1. Update positions and apply friction
  alivePlayers.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;

    // Apply sliding friction
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    // Zero out velocity if incredibly slow to stop drifting forever
    if (Math.hypot(p.vx, p.vy) < 0.05) {
      p.vx = 0;
      p.vy = 0;
    }
    p.maxSpeed = Math.max(p.maxSpeed || 0, Math.hypot(p.vx, p.vy));
  });

  // 2. Circle-to-Circle Collision Checks
  const collisions = [];
  for (let i = 0; i < alivePlayers.length; i++) {
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const p1 = alivePlayers[i];
      const p2 = alivePlayers[j];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      const minDist = PLAYER_RADIUS * 2;

      if (dist < minDist) {
        // Collided!
        const overlap = minDist - dist;
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);

        // Resolve overlap (push circles apart equally)
        p1.x -= nx * (overlap / 2);
        p1.y -= ny * (overlap / 2);
        p2.x += nx * (overlap / 2);
        p2.y += ny * (overlap / 2);

        // Calculate relative velocity
        const rvx = p2.vx - p1.vx;
        const rvy = p2.vy - p1.vy;

        // Velocity along collision normal
        const velAlongNormal = rvx * nx + rvy * ny;

        // Only resolve if they are moving towards each other
        if (velAlongNormal < 0) {
          // Calculate impulse scalar
          // Since mass of both players is equal (1.0), reduced mass is 0.5
          const impulse = -(1 + BOUNCE_RESTITUTION) * velAlongNormal * 0.5;

          // Apply impulse to each player
          p1.vx -= impulse * nx;
          p1.vy -= impulse * ny;
          p2.vx += impulse * nx;
          p2.vy += impulse * ny;

          // Save collision event data for clients to render particle impact sparks
          collisions.push({
            x: p1.x + nx * PLAYER_RADIUS,
            y: p1.y + ny * PLAYER_RADIUS,
            p1Id: p1.id,
            p2Id: p2.id,
            p1Color: p1.color,
            p2Color: p2.color,
            intensity: Math.abs(velAlongNormal)
          });

          if (room.stats) {
            room.stats.collisions += 1;
          }
        }
      }
    }
  }

  // 3. Boundary / Elimination Check
  alivePlayers.forEach(p => {
    const distFromCenter = Math.hypot(p.x - ARENA_X, p.y - ARENA_Y);
    if (distFromCenter > ARENA_RADIUS) {
      // ELIMINATED! Player's center crossed the circular boundary
      p.isAlive = false;
      p.vx = 0;
      p.vy = 0;
      p.eliminatedAtTick = room.battleTicks;

      const lastTouch = players
        .filter(other => other.id !== p.id && other.isAlive)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];

      if (lastTouch) {
        lastTouch.knockouts = (lastTouch.knockouts || 0) + 1;
      }

      // Broadcast elimination event so clients can play explosions
      io.to(roomCode).emit('player_eliminated', {
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y
      });
    }
  });

  // 4. Check for Winner/Round End
  const survivors = players.filter(p => p.isAlive);
  if (survivors.length === 1 && players.length > 1) {
    // We have a single winner!
    const winner = survivors[0];
    winner.score += 1;
    endMatch(roomCode, winner);
  } else if (survivors.length === 0) {
    // Simultaneous elimination of all remaining players: Draw!
    endMatch(roomCode, null);
  } else if (survivors.length === 1 && players.length === 1) {
    // Single player sandbox, winner is themselves when they stay inside
    // (We don't immediately end the match unless they choose to, or we let them drift to stop)
    if (Math.hypot(survivors[0].vx, survivors[0].vy) === 0) {
      const winner = survivors[0];
      winner.score += 1;
      endMatch(roomCode, winner);
    }
  } else if (survivors.length > 1 && alivePlayers.every(p => Math.hypot(p.vx, p.vy) === 0) && room.battleTicks > 90) {
    // If everyone has settled without leaving the arena, award the round to the player closest to center.
    const winner = survivors.reduce((best, player) => {
      const bestDist = Math.hypot(best.x - ARENA_X, best.y - ARENA_Y);
      const playerDist = Math.hypot(player.x - ARENA_X, player.y - ARENA_Y);
      return playerDist < bestDist ? player : best;
    }, survivors[0]);
    winner.score += 1;
    endMatch(roomCode, winner);
  }

  // 5. Broadcast updated coordinates and collisions to clients
  io.to(roomCode).emit('physics_update', {
    players: Object.values(room.players).map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      isAlive: p.isAlive
    })),
    collisions
  });
}

// End Match and transition to GAMEOVER
function endMatch(roomCode, winner) {
  const room = rooms[roomCode];
  if (!room) return;

  room.gameState = 'GAMEOVER';
  if (room.physicsIntervalId) {
    clearInterval(room.physicsIntervalId);
    room.physicsIntervalId = null;
  }

  io.to(roomCode).emit('match_ended', {
    winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
    stats: {
      collisions: room.stats ? room.stats.collisions : 0,
      maxSpeed: Math.max(0, ...Object.values(room.players).map(p => p.maxSpeed || 0)),
      knockouts: Math.max(0, ...Object.values(room.players).map(p => p.knockouts || 0))
    },
    room: getRoomPayload(room)
  });
}

// Run bot AI aiming before countdown reaches 0
function runBotAI(room) {
  const players = Object.values(room.players);
  const bots = players.filter(p => p.isBot && p.isAlive);
  const humans = players.filter(p => !p.isBot && p.isAlive);

  bots.forEach(bot => {
    // Bot AI: Find a target (a random active human player, or another active bot if no humans are alive)
    let target = null;
    if (humans.length > 0) {
      target = humans[Math.floor(Math.random() * humans.length)];
    } else {
      const otherBots = bots.filter(b => b.id !== bot.id);
      if (otherBots.length > 0) {
        target = otherBots[Math.floor(Math.random() * otherBots.length)];
      }
    }

    let targetX = ARENA_X;
    let targetY = ARENA_Y;

    if (target) {
      // Aim at target position
      targetX = target.x;
      targetY = target.y;
    }

    // Calculate angle towards target with a slight random deviation for realism
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    let angle = Math.atan2(dy, dx);

    // Add random error of up to +/- 20 degrees
    const error = (Math.random() - 0.5) * (40 * Math.PI / 180);
    angle += error;

    // Aim force between 0.65 and 1.0
    const force = 0.65 + Math.random() * 0.35;

    bot.angle = angle;
    bot.force = force;
  });
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', ({ playerName, playerColor }) => {
    const roomCode = generateRoomCode();
    socket.join(roomCode);

    rooms[roomCode] = {
      code: roomCode,
      players: {},
      gameState: 'LOBBY',
      countdown: 5,
      timerId: null,
      physicsIntervalId: null,
      battleTicks: 0,
      stats: { collisions: 0 }
    };

    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      name: playerName || 'Player 1',
      color: playerColor || '#00f0ff',
      isReady: false,
      isHost: true,
      isBot: false,
      isAlive: true,
      x: ARENA_X,
      y: ARENA_Y,
      vx: 0,
      vy: 0,
      angle: 0,
      force: 0.5,
      score: 0,
      maxSpeed: 0,
      knockouts: 0
    };

    socket.emit('room_created', getRoomPayload(rooms[roomCode]));
    console.log(`Room created: ${roomCode} by ${playerName}`);
  });

  // Join Room
  socket.on('join_room', ({ roomCode, playerName, playerColor }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('error_message', 'Room not found.');
      return;
    }

    if (room.gameState !== 'LOBBY') {
      socket.emit('error_message', 'Match already in progress.');
      return;
    }

    socket.join(code);

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || `Player ${Object.keys(room.players).length + 1}`,
      color: playerColor || '#ff2a5f',
      isReady: false,
      isHost: false,
      isBot: false,
      isAlive: true,
      x: ARENA_X,
      y: ARENA_Y,
      vx: 0,
      vy: 0,
      angle: 0,
      force: 0.5,
      score: 0,
      maxSpeed: 0,
      knockouts: 0
    };

    console.log(`${playerName} joined room ${code}`);
    socket.emit('room_joined', getRoomPayload(room));
    broadcastRoomUpdate(code);
  });

  // Add Bot (Host only)
  socket.on('add_bot', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Check if player is the host
    const requester = room.players[socket.id];
    if (!requester || !requester.isHost) return;

    // Cap total players at 8
    if (Object.keys(room.players).length >= 8) {
      socket.emit('error_message', 'Room is full (max 8 players).');
      return;
    }

    // Generate unique Bot ID
    const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
    const botIndex = Object.values(room.players).filter(p => p.isBot).length;
    
    const name = BOT_NAMES[botIndex % BOT_NAMES.length];
    const color = BOT_COLORS[botIndex % BOT_COLORS.length];

    room.players[botId] = {
      id: botId,
      name: `${name} (Bot)`,
      color: color,
      isReady: true, // Bots are always ready!
      isHost: false,
      isBot: true,
      isAlive: true,
      x: ARENA_X,
      y: ARENA_Y,
      vx: 0,
      vy: 0,
      angle: 0,
      force: 0.5,
      score: 0,
      maxSpeed: 0,
      knockouts: 0
    };

    console.log(`Bot added to room ${roomCode}: ${name}`);
    broadcastRoomUpdate(roomCode);
  });

  // Remove Bot (Host only)
  socket.on('remove_bot', ({ roomCode, botId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const requester = room.players[socket.id];
    if (!requester || !requester.isHost) return;

    if (room.players[botId] && room.players[botId].isBot) {
      delete room.players[botId];
      console.log(`Bot removed from room ${roomCode}: ${botId}`);
      broadcastRoomUpdate(roomCode);
    }
  });

  // Toggle Ready State
  socket.on('toggle_ready', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[socket.id];
    if (player) {
      player.isReady = !player.isReady;
      console.log(`Player ${player.name} in room ${roomCode} ready: ${player.isReady}`);
      broadcastRoomUpdate(roomCode);
    }
  });

  // Start Match (Host only)
  socket.on('start_match', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const host = room.players[socket.id];
    if (!host || !host.isHost) return;

    const players = Object.values(room.players);

    // Require at least 2 entities (players or bots) to start
    if (players.length < 2) {
      socket.emit('error_message', 'Need at least 2 players/bots to start.');
      return;
    }

    // Require all human players to be ready
    const humans = players.filter(p => !p.isBot);
    const allHumansReady = humans.every(p => p.isReady || p.isHost);
    if (!allHumansReady) {
      socket.emit('error_message', 'Waiting for all players to ready up.');
      return;
    }

    // Set game state to AIMING
    room.gameState = 'AIMING';
    room.countdown = 5;
    room.battleTicks = 0;
    room.stats = { collisions: 0 };

    // Distribute players in the center circle in fair, non-overlapping positions
    const numPlayers = players.length;
    players.forEach((player, index) => {
      const angle = (index * 2 * Math.PI) / numPlayers;
      player.x = ARENA_X + Math.cos(angle) * SPAWN_RADIUS;
      player.y = ARENA_Y + Math.sin(angle) * SPAWN_RADIUS;
      player.vx = 0;
      player.vy = 0;
      player.isAlive = true;
      player.angle = angle + Math.PI; // Aim towards center initially
      player.force = 0.5;
      player.maxSpeed = 0;
      player.knockouts = 0;
      player.eliminatedAtTick = null;
    });

    // Notify clients that aiming phase has started
    io.to(roomCode).emit('aiming_start', getRoomPayload(room));

    // Clear any existing timer
    if (room.timerId) clearInterval(room.timerId);

    // Countdown Timer
    room.timerId = setInterval(() => {
      room.countdown--;

      if (room.countdown > 0) {
        io.to(roomCode).emit('countdown_tick', { countdown: room.countdown });
      } else {
        // Countdown reached 0! Launch time!
        clearInterval(room.timerId);
        room.timerId = null;

        // Run AI calculations for bots immediately before launch
        runBotAI(room);

        // Transition room state to BATTLE
        room.gameState = 'BATTLE';

        // Start Authoritative Physics
        startPhysicsLoop(roomCode);
      }
    }, 1000);
  });

  // Receive Aim input from active player
  socket.on('set_aim', ({ roomCode, angle, force }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'AIMING') return;

    const player = room.players[socket.id];
    if (player && player.isAlive) {
      // Clamp force between 0 and 1
      player.angle = angle;
      player.force = Math.max(0, Math.min(1, force));

      // Broadcast changes to update aiming arrows for other players
      socket.to(roomCode).emit('player_aim_updated', {
        id: socket.id,
        angle: player.angle,
        force: player.force
      });
    }
  });

  // Request Restart / Play Again (Host only)
  socket.on('restart_match', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const host = room.players[socket.id];
    if (!host || !host.isHost) return;

    // Reset physics intervals and timers
    if (room.physicsIntervalId) {
      clearInterval(room.physicsIntervalId);
      room.physicsIntervalId = null;
    }
    if (room.timerId) {
      clearInterval(room.timerId);
      room.timerId = null;
    }

    // Reset states back to lobby
    room.gameState = 'LOBBY';
    room.countdown = 5;
    room.battleTicks = 0;
    room.stats = { collisions: 0 };
    Object.values(room.players).forEach(player => {
      player.isReady = player.isBot ? true : false; // Bots stay ready
      player.isAlive = true;
      player.vx = 0;
      player.vy = 0;
      player.angle = 0;
      player.force = 0.5;
      player.maxSpeed = 0;
      player.knockouts = 0;
      player.eliminatedAtTick = null;
    });

    console.log(`Room restarted: ${roomCode}`);
    io.to(roomCode).emit('match_restarted', getRoomPayload(room));
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);

    // Scan all rooms and remove player
    Object.keys(rooms).forEach(roomCode => {
      const room = rooms[roomCode];
      if (room.players[socket.id]) {
        const removedPlayer = room.players[socket.id];
        delete room.players[socket.id];

        console.log(`Removed ${removedPlayer.name} from room ${roomCode}`);

        const players = Object.values(room.players);
        const humanPlayers = players.filter(p => !p.isBot);

        if (humanPlayers.length === 0) {
          // No human players left in room, destroy it entirely
          if (room.physicsIntervalId) clearInterval(room.physicsIntervalId);
          if (room.timerId) clearInterval(room.timerId);
          delete rooms[roomCode];
          console.log(`Destroyed empty room ${roomCode}`);
        } else {
          // If the host disconnected, reassign host status to another human player
          if (removedPlayer.isHost) {
            humanPlayers[0].isHost = true;
            console.log(`Reassigned host in room ${roomCode} to ${humanPlayers[0].name}`);
          }

          // If in BATTLE or AIMING, check if the game is still playable
          if (room.gameState === 'BATTLE') {
            const alivePlayers = players.filter(p => p.isAlive);
            if (alivePlayers.length === 1 && players.length > 1) {
              const winner = alivePlayers[0];
              winner.score += 1;
              endMatch(roomCode, winner);
            } else if (alivePlayers.length === 0) {
              endMatch(roomCode, null);
            }
          }

          broadcastRoomUpdate(roomCode);
        }
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`   CLASHUP SERVER RUNNING ON PORT ${PORT}      `);
  console.log(`   Open: http://localhost:${PORT}             `);
  console.log(`=============================================`);
});
