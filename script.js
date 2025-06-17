document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let gameState = 'menu'; // 'menu', 'lobby', 'local_game', 'online_game'
    let peer = null;
    let myPeerId = null;
    let isHost = false;
    let connections = {}; // host: {conn1, conn2, ...}, client: {conn_to_host}
    let lobbyInfo = {}; // { hostId, players: [{id, color, name}], maxPlayers }
    let myPlayerColor = '';
    
    // --- DOM Elements ---
    const allScreens = document.querySelectorAll('#main-menu-screen, #local-settings-screen, #online-settings-screen, #online-lobby-screen, #game-container');
    const mainMenu = document.getElementById('main-menu-screen');
    const localSettingsScreen = document.getElementById('local-settings-screen');
    const onlineSettingsScreen = document.getElementById('online-settings-screen');
    const onlineLobbyScreen = document.getElementById('online-lobby-screen');
    const gameContainer = document.getElementById('game-container');
    const settingsModal = document.getElementById('settings-modal');

    // Menu Buttons
    document.getElementById('local-play-btn').addEventListener('click', () => showScreen(localSettingsScreen));
    document.getElementById('online-play-btn').addEventListener('click', () => showScreen(onlineSettingsScreen));
    document.querySelectorAll('.menu-back-btn').forEach(btn => {
        btn.addEventListener('click', () => showScreen(document.getElementById(btn.dataset.target)));
    });

    // --- Universal Settings ---
    const universalSettingsBtn = document.getElementById('universal-settings-btn');
    const toggleMusicBtn = document.getElementById('toggle-music-btn');
    const exitGameBtn = document.getElementById('exit-game-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const bgMusic = document.getElementById('bg-music');
    let isMusicOn = true;

    universalSettingsBtn.addEventListener('click', () => {
        // "Exit Game" बटन को सही संदर्भ में दिखाएं/छिपाएं
        exitGameBtn.classList.toggle('hidden', gameState === 'menu');
        settingsModal.classList.remove('hidden');
    });
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    toggleMusicBtn.addEventListener('click', () => {
        isMusicOn = !isMusicOn;
        toggleMusicBtn.textContent = `Music: ${isMusicOn ? 'ON' : 'OFF'}`;
        isMusicOn ? bgMusic.play().catch(e => {}) : bgMusic.pause();
    });
    exitGameBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to exit to the main menu?")) {
            // कनेक्शन बंद करें और रीसेट करें
            if (peer) {
                peer.destroy();
                peer = null;
            }
            location.reload(); // सबसे आसान तरीका रीसेट करने का
        }
    });

    function showScreen(screenToShow) {
        allScreens.forEach(s => s.classList.add('hidden'));
        screenToShow.classList.remove('hidden');
    }

    // ===================================================================
    // --- LOCAL GAME LOGIC ---
    // ===================================================================
    const localPlayerBtns = document.querySelectorAll('#local-settings-screen .player-btn');
    const playerTypeToggles = document.querySelectorAll('.player-type-toggle');
    const startLocalGameBtn = document.getElementById('start-local-game-btn');
    let localNumPlayers = 4;
    let localPlayerTypes = { red: 'human', green: 'bot', yellow: 'human', blue: 'bot' };

    localPlayerBtns.forEach(btn => btn.addEventListener('click', () => {
        localPlayerBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localNumPlayers = parseInt(btn.dataset.players);
        updateLocalPlayerTypeVisibility();
    }));
    playerTypeToggles.forEach(toggle => toggle.addEventListener('click', () => {
        const player = toggle.dataset.player;
        const newType = toggle.dataset.type === 'human' ? 'bot' : 'human';
        toggle.dataset.type = newType;
        toggle.textContent = newType.charAt(0).toUpperCase() + newType.slice(1);
        localPlayerTypes[player] = newType;
    }));
    function updateLocalPlayerTypeVisibility() {
        const visiblePlayers = (localNumPlayers === 2) ? ['red', 'yellow'] : (localNumPlayers === 3) ? ['red', 'green', 'yellow'] : ['red', 'green', 'yellow', 'blue'];
        document.querySelectorAll('.player-type-row').forEach(row => {
            row.style.display = visiblePlayers.some(p => row.classList.contains(p)) ? 'flex' : 'none';
        });
    }
    startLocalGameBtn.addEventListener('click', () => {
        gameState = 'local_game';
        showScreen(gameContainer);
        // यहाँ से आपका पुराना पूरा लोकल गेम लॉजिक शुरू होगा
        // For brevity, I'll call a master function `runLocalGame`
        runLocalGame(localNumPlayers, localPlayerTypes);
    });
    
    // ===================================================================
    // --- ONLINE GAME (P2P) LOGIC ---
    // ===================================================================
    const createOnlineGameBtn = document.getElementById('create-online-game-btn');
    const joinOnlineGameBtn = document.getElementById('join-online-game-btn');
    const joinCodeInput = document.getElementById('join-code-input');
    const gameCodeDisplay = document.getElementById('game-code-display');
    const lobbyPlayerList = document.getElementById('lobby-player-list');
    const lobbyStatus = document.getElementById('lobby-status');

    createOnlineGameBtn.addEventListener('click', () => {
        isHost = true;
        // Temporary logic for creating a 4-player game. You can add options later.
        const maxPlayers = 4; // Or get from a selection
        const playerColors = ['red', 'green', 'yellow', 'blue'];
        
        peer = new Peer();
        peer.on('open', id => {
            myPeerId = id;
            const gameCode = id.substr(-6).toUpperCase();
            gameCodeDisplay.textContent = gameCode;
            
            lobbyInfo = {
                hostId: myPeerId,
                maxPlayers: maxPlayers,
                players: [{ id: myPeerId, color: 'red', name: `Player 1` }]
            };
            myPlayerColor = 'red';
            updateLobbyUI();
            showScreen(onlineLobbyScreen);
        });
        
        peer.on('connection', (conn) => {
            // Handle new player joining
            conn.on('open', () => {
                if(lobbyInfo.players.length < lobbyInfo.maxPlayers) {
                    const newPlayerColor = playerColors[lobbyInfo.players.length];
                    const newPlayer = { id: conn.peer, color: newPlayerColor, name: `Player ${lobbyInfo.players.length + 1}`};
                    lobbyInfo.players.push(newPlayer);
                    connections[conn.peer] = conn;
                    
                    // Send lobby info to the new player
                    conn.send({ type: 'lobby_joined', lobbyInfo, yourColor: newPlayerColor });
                    
                    // Inform all other players about the new player
                    broadcastToLobby({ type: 'player_update', lobbyInfo });
                    
                    updateLobbyUI();
                } else {
                    conn.send({type: 'error', message: 'Lobby is full.'});
                    conn.close();
                }
            });
            handleConnectionData(conn);
        });
    });

    joinOnlineGameBtn.addEventListener('click', () => {
        // Note: This is a simplified join logic. A real implementation needs a way to map 6-digit code to full PeerJS ID.
        // For this example, we assume the host shares their full PeerJS ID.
        const hostId = joinCodeInput.value.trim();
        if (!hostId) { alert("Please enter a valid Game ID."); return; }
        
        isHost = false;
        peer = new Peer();
        peer.on('open', () => {
            const conn = peer.connect(hostId);
            connections[hostId] = conn;
            conn.on('open', () => {
                showScreen(onlineLobbyScreen);
                lobbyStatus.textContent = "Connecting to lobby...";
            });
            handleConnectionData(conn);
        });
    });
    
    function handleConnectionData(conn) {
        conn.on('data', data => {
            console.log("Received Data:", data);
            switch(data.type) {
                case 'lobby_joined':
                    lobbyInfo = data.lobbyInfo;
                    myPlayerColor = data.yourColor;
                    updateLobbyUI();
                    break;
                case 'player_update':
                    lobbyInfo = data.lobbyInfo;
                    updateLobbyUI();
                    break;
                case 'game_start':
                    gameState = 'online_game';
                    showScreen(gameContainer);
                    // Start online game logic here
                    runOnlineGame(lobbyInfo.players.map(p => p.color));
                    break;
                // Add game event handlers (dice roll, token move etc.) here
            }
        });
    }

    function updateLobbyUI() {
        lobbyPlayerList.innerHTML = '';
        lobbyInfo.players.forEach(p => {
            const playerDiv = document.createElement('div');
            playerDiv.className = `lobby-player ${p.color}`;
            playerDiv.textContent = `${p.name} (${p.color.toUpperCase()})`;
            if(p.id === myPeerId) playerDiv.textContent += " (You)";
            lobbyPlayerList.appendChild(playerDiv);
        });
        document.getElementById('players-in-lobby').textContent = lobbyInfo.players.length;
        document.getElementById('total-players-lobby').textContent = lobbyInfo.maxPlayers;
        
        if (lobbyInfo.players.length === lobbyInfo.maxPlayers) {
            lobbyStatus.textContent = "Lobby is full! The host can start the game.";
            if (isHost) document.getElementById('start-online-game-btn').classList.remove('hidden');
        } else {
            lobbyStatus.textContent = "Waiting for other players to join...";
            if (isHost) document.getElementById('start-online-game-btn').classList.add('hidden');
        }
    }
    
    document.getElementById('start-online-game-btn').addEventListener('click', () => {
        if(isHost) {
            broadcastToLobby({ type: 'game_start' });
            // Start game for host too
            gameState = 'online_game';
            showScreen(gameContainer);
            runOnlineGame(lobbyInfo.players.map(p => p.color));
        }
    });
    
    function broadcastToLobby(data) {
        Object.values(connections).forEach(conn => {
            conn.send(data);
        });
    }

    // ===================================================================
    // --- MASTER GAME LOGIC (called by Local or Online mode) ---
    // This is your old game logic, now modularized.
    // ===================================================================
    function runLocalGame(numPlayers, playerTypes) {
        const activePlayers = (numPlayers === 2) ? ['red', 'yellow'] : (numPlayers === 3) ? ['red', 'green', 'yellow'] : ['red', 'green', 'yellow', 'blue'];
        // All your previous JS code for local play goes here.
        // It's a lot, so I'm summarizing the entry point.
        // You would initialize the board, set up turns, handle dice rolls,
        // check for bot turns, etc. based on the `activePlayers` and `playerTypes` variables.
        alert(`Starting a ${numPlayers}-player local game!`);
        // For a complete solution, you would copy-paste your entire previous `script.js` content here,
        // and adapt it to use these parameters.
        initializeAndRunGame(activePlayers, playerTypes);
    }
    
    function runOnlineGame(activePlayers) {
        // This function will set up the game for online play.
        // It will listen for dice clicks ONLY from the current player,
        // send data to other peers, and receive data to update the board.
        alert(`Starting an online game with players: ${activePlayers.join(', ')}`);
        initializeAndRunGame(activePlayers, null); // null for playerTypes, as all are human
    }

    // --- Core Game Engine (used by both modes) ---
    // This is a simplified placeholder for your massive game logic.
    function initializeAndRunGame(activePlayers, playerTypes) {
        console.log("Initializing game for:", activePlayers);
        console.log("Player types (if local):", playerTypes);
        // ... all your board creation, token creation, turn logic, etc.
        // would be called from here.
    }

});

// NOTE: The `initializeAndRunGame` is a placeholder. 
// You need to copy your original, complete game logic (dice rolling, token movement, bot AI, etc.) 
// and structure it to be called by `runLocalGame` and `runOnlineGame`.
// The online functions would wrap actions (like `rollDice`) with `conn.send()` calls.