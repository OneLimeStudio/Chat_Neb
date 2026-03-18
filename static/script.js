// ===================================================
// Nebula Chat — Script.js
// ===================================================

const GLOBAL_ROOM_ID = "GLOBAL_ROOM";

// --- State ---
let currentUser   = null;
let selectedUser  = GLOBAL_ROOM_ID;
let ws            = null;
let usersList     = [];

// --- DOM ---
const loginOverlay      = document.getElementById('login-overlay');
const loginForm         = document.getElementById('login-form');
const usernameInput     = document.getElementById('username-input');

const dashboard         = document.getElementById('dashboard');
const currentUserDisplay= document.getElementById('current-user-display');
const userDotInitial    = document.getElementById('user-dot-initial');
const usersContainer    = document.getElementById('users-container');
const globalRoomBtn     = document.getElementById('global-room-btn');

const activeChatView    = document.getElementById('active-chat');
const noChatView        = document.getElementById('no-chat-selected');
const chatPartnerName   = document.getElementById('chat-partner-name');
const chatContextBadge  = document.getElementById('chat-context-badge');
const chatHeaderAvatar  = document.getElementById('chat-header-avatar');
const statusIndicator   = document.getElementById('status-indicator');
const statusText        = document.getElementById('status-text');
const messagesContainer = document.getElementById('messages-container');
const messageForm       = document.getElementById('message-form');
const messageInput      = document.getElementById('message-input');
const imageInput        = document.getElementById('image-input');


// ===================================================
// 1. LOGIN
// ===================================================
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    if (!name || name.toUpperCase() === GLOBAL_ROOM_ID) {
        alert("Invalid name. Please try another.");
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name })
        });

        if (response.ok) {
            currentUser = name;
            loginOverlay.classList.remove('active');
            setTimeout(() => {
                loginOverlay.style.display = 'none';
                dashboard.style.display = 'flex';
                // populate user pill
                currentUserDisplay.textContent = name;
                userDotInitial.textContent = name.charAt(0).toUpperCase();
                // connect & load
                connectWebSocket();
                fetchUsers();
                setInterval(fetchUsers, 5000);
                selectUser(GLOBAL_ROOM_ID);
            }, 500);
        } else {
            const data = await response.json().catch(() => ({}));
            alert(data.detail || 'Login failed. Please try a different name.');
        }
    } catch (error) {
        console.error("Login error:", error);
        alert('Could not reach the server. Please try again.');
    }
});


// ===================================================
// 2. USERS LIST & SELECTION
// ===================================================
async function fetchUsers() {
    if (!currentUser) return;
    try {
        const res  = await fetch('/api/users');
        const data = await res.json();
        usersList  = data.users.filter(u => u !== currentUser);
        renderUserList();
    } catch (err) {
        console.error("Error fetching users:", err);
    }
}

function renderUserList() {
    if (usersList.length === 0) {
        usersContainer.innerHTML = `<div class="list-placeholder">No other users yet.<br>Share the link to invite someone!</div>`;
        return;
    }

    usersContainer.innerHTML = '';
    usersList.forEach(user => {
        const div    = document.createElement('div');
        div.className = `user-item ${selectedUser === user ? 'active' : ''}`;

        const avatar    = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.textContent = user.charAt(0).toUpperCase();

        const nameSpan    = document.createElement('span');
        nameSpan.textContent = user;

        div.appendChild(avatar);
        div.appendChild(nameSpan);
        div.onclick = () => selectUser(user);
        usersContainer.appendChild(div);
    });
}

globalRoomBtn.onclick = () => selectUser(GLOBAL_ROOM_ID);

async function selectUser(user) {
    selectedUser = user;

    // Update sidebar active states
    globalRoomBtn.classList.toggle('active', user === GLOBAL_ROOM_ID);
    renderUserList();

    // Update header
    if (user === GLOBAL_ROOM_ID) {
        chatPartnerName.textContent = "Global Room";
        chatContextBadge.textContent = "Public";
        chatContextBadge.className = "badge public";
        messageInput.placeholder = "Message the Global Room...";
        // Header avatar — globe icon (public)
        chatHeaderAvatar.className = "chat-avatar-lg public";
        chatHeaderAvatar.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>`;
    } else {
        chatPartnerName.textContent = user;
        chatContextBadge.textContent = "Direct";
        chatContextBadge.className = "badge private";
        messageInput.placeholder = `Message ${user}...`;
        // Header avatar — initial letter (private)
        chatHeaderAvatar.className = "chat-avatar-lg private";
        chatHeaderAvatar.textContent = user.charAt(0).toUpperCase();
    }

    loadChatHistory();
    setTimeout(() => messageInput.focus(), 100);
}


// ===================================================
// 3. HISTORY & RENDERING
// ===================================================
async function loadChatHistory() {
    messagesContainer.innerHTML = '';
    try {
        const res  = await fetch(`/api/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(selectedUser)}`);
        const data = await res.json();
        data.messages.forEach(msg => renderMessage(msg));
        scrollToBottom();
    } catch (err) {
        console.error("Error loading history:", err);
    }
}

function formatTime(timestampStr) {
    if (!timestampStr) return '';
    try {
        const date = new Date(timestampStr + "Z");
        let hours  = date.getHours();
        let min    = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        min   = min < 10 ? '0' + min : min;
        return `${hours}:${min} ${ampm}`;
    } catch(e) {
        return '';
    }
}

function renderMessage(msg) {
    const isSelf = msg.sender === currentUser;

    const wrapper = document.createElement('div');
    wrapper.className = `message ${isSelf ? 'self' : 'other'}`;

    // Sender name (visible for others in global room)
    if (!isSelf && selectedUser === GLOBAL_ROOM_ID) {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'msg-sender';
        senderSpan.textContent = msg.sender;
        wrapper.appendChild(senderSpan);
    }

    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    
    if (msg.type === 'image') {
        bubble.classList.add('image-bubble');
        const img = document.createElement('img');
        img.src = msg.content;
        img.alt = "Shared image";
        img.loading = "lazy";
        bubble.appendChild(img);
    } else {
        bubble.textContent = msg.content;
    }
    
    wrapper.appendChild(bubble);

    // Timestamp
    if (msg.timestamp) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        timeSpan.textContent = formatTime(msg.timestamp);
        wrapper.appendChild(timeSpan);
    }

    messagesContainer.appendChild(wrapper);
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// ===================================================
// 4. WEBSOCKET
// ===================================================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl    = `${protocol}//${window.location.host}/ws/${encodeURIComponent(currentUser)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        statusIndicator.classList.add('connected');
        statusText.textContent = 'Online';
    };

    ws.onclose = () => {
        statusIndicator.classList.remove('connected');
        statusText.textContent = 'Reconnecting...';
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // Route: global room message
            if (selectedUser === GLOBAL_ROOM_ID && data.recipient === GLOBAL_ROOM_ID) {
                renderMessage(data);
            }
            // Route: private chat message
            else if (
                selectedUser !== GLOBAL_ROOM_ID &&
                ((data.sender === currentUser && data.recipient === selectedUser) ||
                 (data.sender === selectedUser && data.recipient === currentUser))
            ) {
                renderMessage(data);
            }
            // else: message for another conversation — could add notification badge here
        } catch (e) {
            console.error("Failed to parse WS message:", e);
        }
    };
}


// ===================================================
// 5. SEND MESSAGE
// ===================================================
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !selectedUser) return;

    sendMessage(text, 'text');
    messageInput.value = '';
    messageInput.focus();
});

function sendMessage(content, type) {
    if (!selectedUser) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ recipient: selectedUser, content: content, type: type }));
    } else {
        alert("Not connected. Please wait...");
    }
}

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please select an image file.");
        return;
    }

    // Limit to 5MB for base64 safety
    if (file.size > 5 * 1024 * 1024) {
        alert("Image too large (max 5MB)");
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target.result;
        sendMessage(dataUrl, 'image');
        // Clear input
        imageInput.value = '';
    };
    reader.readAsDataURL(file);
});


// ===================================================
// Init
// ===================================================
window.onload = () => usernameInput.focus();
