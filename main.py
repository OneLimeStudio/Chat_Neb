import os
import sqlite3
import json
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, List, Optional

app = FastAPI(title="Nebula Chat", version="1.0.0")

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
        CREATE TABLE IF NOT EXISTS messages (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            sender    TEXT,
            recipient TEXT,
            content   TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
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
async def get_users():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT username FROM users ORDER BY username ASC')
    users = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"users": users}

# ─────────────────────────────────────────────
# API: Messages History
# ─────────────────────────────────────────────
@app.get("/api/messages/{user1}/{user2}")
async def get_messages(user1: str, user2: str):
    conn = get_db()
    cursor = conn.cursor()

    if user2 == "GLOBAL_ROOM":
        cursor.execute('''
            SELECT sender, recipient, content, timestamp FROM messages
            WHERE recipient = 'GLOBAL_ROOM'
            ORDER BY timestamp ASC
            LIMIT 200
        ''')
    else:
        cursor.execute('''
            SELECT sender, recipient, content, timestamp FROM messages
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY timestamp ASC
            LIMIT 200
        ''', (user1, user2, user2, user1))

    messages = [
        {"sender": row[0], "recipient": row[1], "content": row[2], "timestamp": row[3]}
        for row in cursor.fetchall()
    ]
    conn.close()
    return {"messages": messages}

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

                if not recipient or not content:
                    continue

                # Persist message
                conn   = get_db()
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO messages (sender, recipient, content)
                    VALUES (?, ?, ?)
                ''', (username, recipient, content))
                conn.commit()
                cursor.execute('SELECT timestamp FROM messages WHERE id = last_insert_rowid()')
                timestamp = cursor.fetchone()[0]
                conn.close()

                payload = json.dumps({
                    "sender":    username,
                    "recipient": recipient,
                    "content":   content,
                    "timestamp": timestamp
                })

                if recipient == "GLOBAL_ROOM":
                    await manager.broadcast(payload)
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
