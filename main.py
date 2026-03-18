import os
import sqlite3
import json
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional

app = FastAPI(title="Nebula Chat", version="1.0.0")

# ─────────────────────────────────────────────
# CORS — Allow requests from GitHub Pages frontend
# and localhost for dev. Add your GitHub Pages URL below.
# ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",   # Allow all origins safely
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# Database Setup
# ─────────────────────────────────────────────
# Use an environment variable for the DB path so it works on any platform.
# On Railway/Hugging Face you can set DB_PATH=/data/chat.db for persistence,
# or leave it as the default (ephemeral, resets on redeploy).
DB_NAME = os.environ.get("DB_PATH", "chat.db")

def get_db():
    """Return a new SQLite connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username  TEXT PRIMARY KEY,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS groups (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            creator     TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS group_members (
            group_id  INTEGER,
            username  TEXT,
            PRIMARY KEY (group_id, username),
            FOREIGN KEY (group_id) REFERENCES groups(id),
            FOREIGN KEY (username) REFERENCES users(username)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            sender    TEXT,
            recipient TEXT,
            content   TEXT,
            type      TEXT DEFAULT 'text',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Handle existing databases that might not have the 'type' column
    try:
        cursor.execute("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'")
        conn.commit()
    except sqlite3.OperationalError:
        # Column already exists
        pass
    conn.commit()
    conn.close()

init_db()

# ─────────────────────────────────────────────
# Static Files & Root
# ─────────────────────────────────────────────
# Get the directory where this file lives so paths work regardless of cwd
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/health")
async def health_check():
    """Simple health endpoint for Railway/render uptime checks."""
    return {"status": "ok"}

# ─────────────────────────────────────────────
# API: Login & Users
# ─────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str

@app.post("/api/login")
async def login(req: LoginRequest):
    username = req.username.strip()
    if not username or username.upper() == "GLOBAL_ROOM":
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(username) > 30:
        raise HTTPException(status_code=400, detail="Username too long (max 30 chars)")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO users (username, last_seen) VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(username) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
    ''', (username,))
    conn.commit()
    conn.close()
    return {"message": "Logged in successfully", "username": username}

@app.get("/api/users")
async def get_users(query: str = ""):
    conn = get_db()
    cursor = conn.cursor()
    if query:
        cursor.execute('SELECT username FROM users WHERE username LIKE ? ORDER BY username ASC', (f'%{query}%',))
    else:
        cursor.execute('SELECT username FROM users ORDER BY username ASC')
    users = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"users": users}

# ─────────────────────────────────────────────
# API: Groups
# ─────────────────────────────────────────────
class GroupCreateRequest(BaseModel):
    name: str
    creator: str

@app.post("/api/groups")
async def create_group(req: GroupCreateRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO groups (name, creator) VALUES (?, ?)', (req.name, req.creator))
    group_id = cursor.lastrowid
    cursor.execute('INSERT INTO group_members (group_id, username) VALUES (?, ?)', (group_id, req.creator))
    conn.commit()
    conn.close()
    return {"id": group_id, "name": req.name}

@app.get("/api/groups")
async def search_groups(query: str = ""):
    conn = get_db()
    cursor = conn.cursor()
    if query:
        cursor.execute('SELECT id, name, creator FROM groups WHERE name LIKE ? ORDER BY name ASC', (f'%{query}%',))
    else:
        cursor.execute('SELECT id, name, creator FROM groups ORDER BY name ASC')
    groups = [{"id": row[0], "name": row[1], "creator": row[2]} for row in cursor.fetchall()]
    conn.close()
    return {"groups": groups}

@app.get("/api/groups/user/{username}")
async def get_user_groups(username: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT g.id, g.name, g.creator FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.username = ?
    ''', (username,))
    groups = [{"id": row[0], "name": row[1], "creator": row[2]} for row in cursor.fetchall()]
    conn.close()
    return {"groups": groups}

@app.post("/api/groups/{group_id}/join")
async def join_group(group_id: int, username: str):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO group_members (group_id, username) VALUES (?, ?)', (group_id, username))
        conn.commit()
    except sqlite3.IntegrityError:
        pass # Already a member
    conn.close()
    return {"message": "Joined group"}

@app.delete("/api/groups/{group_id}")
async def delete_group(group_id: int, username: str):
    conn = get_db()
    cursor = conn.cursor()
    # Check if user is the creator
    cursor.execute('SELECT creator FROM groups WHERE id = ?', (group_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Group not found")
    if row[0] != username:
        conn.close()
        raise HTTPException(status_code=403, detail="Only the creator can delete the group")
    
    cursor.execute('DELETE FROM group_members WHERE group_id = ?', (group_id,))
    cursor.execute('DELETE FROM groups WHERE id = ?', (group_id,))
    cursor.execute("DELETE FROM messages WHERE recipient = ?", (f"GROUP_{group_id}",))
    conn.commit()
    conn.close()
    return {"message": "Group deleted"}

# ─────────────────────────────────────────────
# API: Messages History
# ─────────────────────────────────────────────
@app.get("/api/messages/{user1}/{user2}")
async def get_messages(user1: str, user2: str):
    conn = get_db()
    cursor = conn.cursor()

    if user2 == "GLOBAL_ROOM":
        cursor.execute('''
            SELECT id, sender, recipient, content, type, timestamp FROM messages
            WHERE recipient = 'GLOBAL_ROOM'
            ORDER BY timestamp ASC
            LIMIT 200
        ''')
    elif user2.startswith("GROUP_"):
        group_id = user2.replace("GROUP_", "")
        cursor.execute('''
            SELECT id, sender, recipient, content, type, timestamp FROM messages
            WHERE recipient = ?
            ORDER BY timestamp ASC
            LIMIT 200
        ''', (user2,))
    else:
        cursor.execute('''
            SELECT id, sender, recipient, content, type, timestamp FROM messages
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY timestamp ASC
            LIMIT 200
        ''', (user1, user2, user2, user1))

    messages = [
        {"id": row[0], "sender": row[1], "recipient": row[2], "content": row[3], "type": row[4], "timestamp": row[5]}
        for row in cursor.fetchall()
    ]
    conn.close()
    return {"messages": messages}

@app.delete("/api/messages/{message_id}")
async def delete_message(message_id: int, username: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT sender FROM messages WHERE id = ?', (message_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Message not found")
    if row[0] != username:
        conn.close()
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    
    cursor.execute('DELETE FROM messages WHERE id = ?', (message_id,))
    conn.commit()
    conn.close()
    return {"message": "Message deleted"}

# ─────────────────────────────────────────────
# WebSocket – Connection Manager
# ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, username: str):
        await websocket.accept()
        self.active_connections[username] = websocket

    def disconnect(self, username: str):
        self.active_connections.pop(username, None)

    async def send_personal_message(self, message: str, username: str):
        ws = self.active_connections.get(username)
        if ws:
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(username)

    async def broadcast(self, message: str):
        dead = []
        for username, ws in self.active_connections.items():
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(username)
        for u in dead:
            self.disconnect(u)

# Create instance
manager = ConnectionManager()

# ─────────────────────────────────────────────
# WebSocket Endpoint
# ─────────────────────────────────────────────
@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await manager.connect(websocket, username)
    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data      = json.loads(data_str)
                recipient = data.get("recipient")
                content   = data.get("content", "").strip()
                msg_type  = data.get("type", "text")

                if not recipient or not content:
                    continue

                # Persist message
                conn   = get_db()
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO messages (sender, recipient, content, type)
                    VALUES (?, ?, ?, ?)
                ''', (username, recipient, content, msg_type))
                conn.commit()
                cursor.execute('SELECT timestamp FROM messages WHERE id = last_insert_rowid()')
                timestamp = cursor.fetchone()[0]
                conn.close()

                payload = json.dumps({
                    "id":        cursor.lastrowid if 'cursor' in locals() else None,
                    "sender":    username,
                    "recipient": recipient,
                    "content":   content,
                    "type":      msg_type,
                    "timestamp": timestamp
                })

                if recipient == "GLOBAL_ROOM":
                    await manager.broadcast(payload)
                elif recipient.startswith("GROUP_"):
                    # Send to all members of the group
                    group_id = recipient.replace("GROUP_", "")
                    conn = get_db()
                    cursor = conn.cursor()
                    cursor.execute('SELECT username FROM group_members WHERE group_id = ?', (group_id,))
                    members = [row[0] for row in cursor.fetchall()]
                    conn.close()
                    for member in members:
                        await manager.send_personal_message(payload, member)
                else:
                    # Send to recipient
                    await manager.send_personal_message(payload, recipient)
                    # Echo to sender (only if they are not the recipient)
                    if recipient != username:
                        await manager.send_personal_message(payload, username)

            except json.JSONDecodeError:
                pass
            except Exception as e:
                print(f"[WS Error] {e}")

    except WebSocketDisconnect:
        manager.disconnect(username)


# ─────────────────────────────────────────────
# Entry point (for local dev)
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
