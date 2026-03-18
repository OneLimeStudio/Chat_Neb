// ===================================================
// Nebula Chat — Script.js
// ===================================================

const GLOBAL_ROOM_ID = "GLOBAL_ROOM";

// --- State ---
let currentUser   = null;
let selectedUser  = GLOBAL_ROOM_ID;
let ws            = null;
let usersList     = [];
let groupsList    = [];
let searchQuery   = "";

// --- DOM ---
const loginOverlay      = document.getElementById('login-overlay');
const loginForm         = document.getElementById('login-form');
const usernameInput     = document.getElementById('username-input');

const dashboard         = document.getElementById('dashboard');
const currentUserDisplay= document.getElementById('current-user-display');
const userDotInitial    = document.getElementById('user-dot-initial');
const usersContainer    = document.getElementById('users-container');
const groupsContainer   = document.getElementById('groups-container');
const globalRoomBtn     = document.getElementById('global-room-btn');
const userSearchInput   = document.getElementById('user-search');

const groupModal        = document.getElementById('group-modal');
const showCreateGroupBtn= document.getElementById('show-create-group');
const closeGroupModalBtn= document.getElementById('close-group-modal');
const createGroupForm   = document.getElementById('create-group-form');
const groupNameInput    = document.getElementById('group-name-input');

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
const deleteGroupBtn    = document.getElementById('delete-group-btn');


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
                fetchGroups();
                setInterval(() => {
                    fetchUsers();
                    fetchGroups();
                }, 5000);
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
// 2. USERS, GROUPS & SELECTION
// ===================================================

// Search Logic
userSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderUserList();
    renderGroupList();
});

async function fetchUsers() {
    if (!currentUser) return;
    try {
        const res  = await fetch(`/api/users?query=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        usersList  = data.users.filter(u => u !== currentUser);
        renderUserList();
    } catch (err) {
        console.error("Error fetching users:", err);
    }
}

async function fetchGroups() {
    if (!currentUser) return;
    try {
        // Fetch groups I'm a member of
        const resUser  = await fetch(`/api/groups/user/${encodeURIComponent(currentUser)}`);
        const dataUser = await resUser.json();
        const myGroups = dataUser.groups;
        
        let allMatchingGroups = [];
        if (searchQuery) {
            // Also search for groups by name
            const resAll = await fetch(`/api/groups?query=${encodeURIComponent(searchQuery)}`);
            const dataAll = await resAll.json();
            allMatchingGroups = dataAll.groups;
        }

        // Merge and mark membership
        groupsList = myGroups.map(g => ({ ...g, isMember: true }));
        
        allMatchingGroups.forEach(g => {
            if (!groupsList.find(mg => mg.id === g.id)) {
                groupsList.push({ ...g, isMember: false });
            }
        });

        renderGroupList();
    } catch (err) {
        console.error("Error fetching groups:", err);
    }
}

function renderUserList() {
    const filteredUsers = searchQuery 
        ? usersList.filter(u => u.toLowerCase().includes(searchQuery))
        : usersList;

    if (filteredUsers.length === 0) {
        usersContainer.innerHTML = `<div class="list-placeholder">${searchQuery ? 'No users found.' : 'No other users yet.'}</div>`;
        return;
    }

    usersContainer.innerHTML = '';
    filteredUsers.forEach(user => {
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

function renderGroupList() {
    const filteredGroups = searchQuery 
        ? groupsList.filter(g => g.name.toLowerCase().includes(searchQuery))
        : groupsList;

    if (filteredGroups.length === 0 && !searchQuery) {
        groupsContainer.innerHTML = `<div class="list-placeholder">No groups yet.</div>`;
        return;
    }

    groupsContainer.innerHTML = '';
    filteredGroups.forEach(group => {
        const groupId = `GROUP_${group.id}`;
        const div    = document.createElement('div');
        div.className = `user-item ${selectedUser === groupId ? 'active' : ''}`;

        const avatar    = document.createElement('div');
        avatar.className = 'user-avatar group-avatar';
        avatar.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>`;

        const nameSpan    = document.createElement('span');
        nameSpan.textContent = group.name;

        div.appendChild(avatar);
        div.appendChild(nameSpan);
        div.onclick = () => selectUser(groupId, group.name);
        groupsContainer.appendChild(div);
    });
}

// Group Creation
showCreateGroupBtn.onclick = () => groupModal.style.display = 'flex';
closeGroupModalBtn.onclick = () => groupModal.style.display = 'none';

createGroupForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = groupNameInput.value.trim();
    if (!name) return;

    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, creator: currentUser })
        });
        if (res.ok) {
            const data = await res.json();
            groupModal.style.display = 'none';
            groupNameInput.value = '';
            fetchGroups();
            selectUser(`GROUP_${data.id}`, data.name);
        }
    } catch (err) {
        console.error("Error creating group:", err);
    }
};

globalRoomBtn.onclick = () => selectUser(GLOBAL_ROOM_ID);

async function selectUser(id, displayName = null) {
    selectedUser = id;

    // Handle group joining if not a member
    if (id.startsWith("GROUP_")) {
        const groupId = id.replace("GROUP_", "");
        const group = groupsList.find(g => g.id == groupId);
        if (group && !group.isMember) {
            try {
                await fetch(`/api/groups/${groupId}/join?username=${encodeURIComponent(currentUser)}`, {
                    method: 'POST'
                });
                group.isMember = true;
            } catch (err) {
                console.error("Join group error:", err);
            }
        }
    }

    // Update header
    if (id === GLOBAL_ROOM_ID) {
        chatPartnerName.textContent = "Global Room";
        chatContextBadge.textContent = "Public";
        chatContextBadge.className = "badge public";
        messageInput.placeholder = "Message the Global Room...";
        chatHeaderAvatar.className = "chat-avatar-lg public";
        chatHeaderAvatar.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>`;
    } else if (id.startsWith("GROUP_")) {
        chatPartnerName.textContent = displayName || "Group Chat";
        chatContextBadge.textContent = "Group";
        chatContextBadge.className = "badge public"; // Using teal for groups too
        messageInput.placeholder = `Message group...`;
        chatHeaderAvatar.className = "chat-avatar-lg public";
        chatHeaderAvatar.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>`;
        
        // Show delete button only to creator
        const groupId = id.replace("GROUP_", "");
        const group = groupsList.find(g => g.id == groupId);
        if (group && group.creator === currentUser) {
            deleteGroupBtn.style.display = 'flex';
            deleteGroupBtn.onclick = () => deleteGroup(groupId);
        } else {
            deleteGroupBtn.style.display = 'none';
        }
    } else {
        chatPartnerName.textContent = id;
        chatContextBadge.textContent = "Direct";
        chatContextBadge.className = "badge private";
        messageInput.placeholder = `Message ${id}...`;
        chatHeaderAvatar.className = "chat-avatar-lg private";
        chatHeaderAvatar.textContent = id.charAt(0).toUpperCase();
        chatHeaderAvatar.innerHTML = '';
        deleteGroupBtn.style.display = 'none';
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

    // Sender name (visible for others in public rooms/groups)
    const isPublicRecipient = selectedUser === GLOBAL_ROOM_ID || selectedUser.startsWith("GROUP_");
    if (!isSelf && isPublicRecipient) {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'msg-sender';
        senderSpan.textContent = msg.sender;
        wrapper.appendChild(senderSpan);
    }

    // Bubble wrapper
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'msg-bubble-wrapper';

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
    
    bubbleWrapper.appendChild(bubble);

    // Delete button for self
    if (isSelf && msg.id) {
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-msg-btn';
        delBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>`;
        delBtn.title = "Delete Message";
        delBtn.onclick = () => deleteMessage(msg.id);
        bubbleWrapper.appendChild(delBtn);
    }

    wrapper.appendChild(bubbleWrapper);

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
            // Route: current view check
            const isMatch = (data.recipient === selectedUser) || 
                          (selectedUser !== GLOBAL_ROOM_ID && !selectedUser.startsWith("GROUP_") && data.sender === selectedUser && data.recipient === currentUser);
            
            if (isMatch) {
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


async function deleteMessage(messageId) {
    if (!confirm("Are you sure you want to delete this message?")) return;
    try {
        const res = await fetch(`/api/messages/${messageId}?username=${encodeURIComponent(currentUser)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            loadChatHistory();
        }
    } catch (err) {
        console.error("Error deleting message:", err);
    }
}

async function deleteGroup(groupId) {
    if (!confirm("Are you sure you want to delete this group? All its messages will be lost.")) return;
    try {
        const res = await fetch(`/api/groups/${groupId}?username=${encodeURIComponent(currentUser)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            selectUser(GLOBAL_ROOM_ID);
            fetchGroups();
        } else {
            const data = await res.json();
            alert(data.detail || "Failed to delete group");
        }
    } catch (err) {
        console.error("Error deleting group:", err);
    }
}


// ===================================================
// Init
// ===================================================
window.onload = () => usernameInput.focus();
