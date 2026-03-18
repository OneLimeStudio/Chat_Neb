# 🐍 Nebula Chat: Backend Logic (Python/FastAPI)

This document provides a line-by-line conceptual breakdown of the Python backend for Nebula Chat.

---

## 1. The Database Layer

We use **SQLite3** because it requires zero configuration and stores everything in a single file (`chat.db`).

### `get_db()`
- **Purpose**: Creates a fresh connection to the database.
- **Key Logic**: `conn.row_factory = sqlite3.Row`. By default, SQLite returns tuples like `(1, 'Alice', 'Hi')`. This line tells Python to return rows that behave like dictionaries, so we can use `row['content']` in our code.

### `init_db()`
- **Purpose**: Runs once at startup to prepare the environment.
- **Logic**:
    - Creates `users` table: Stores unique names and the last time they were seen.
    - Creates `messages` table: Stores every chat bubble ever sent.
    - **Migrations**: I added a `try/except` block to check if the `type` column exists. This prevents the app from crashing if you upgraded from an older version that only supported text.

---

## 2. User & Authentication Logic

We don't use passwords to keep the app "frictionless."

### `POST /api/login`
- **Logic**: It takes the username, strips whitespace, and converts it to uppercase to check if it's "GLOBAL_ROOM" (a reserved name).
- **The "UPSERT"**: `INSERT ... ON CONFLICT(username) DO UPDATE`. 
    - *Why?* If it's a new user, it creates them. If they already exist, it just updates their `last_seen` timestamp. This keeps the user list fresh.

### `GET /api/users`
- **Logic**: A simple `SELECT username FROM users`. 
- **Purpose**: The frontend hits this every 5 seconds to update the sidebar so you can see who else is online.

---

## 3. The Messaging Engine

This is where the complex data filtering happens.

### `GET /api/messages/{user1}/{user2}`
- **Logic**: 
    - If `user2` is `GLOBAL_ROOM`, it fetches all messages where the recipient is the global room.
    - If it's a private chat, it uses an `OR` query: `(sender=A AND recipient=B) OR (sender=B AND recipient=A)`.
    - **Limit**: It only pulls the last 200 messages to keep the app fast and prevent mobile browsers from crashing.

---

## 4. WebSockets: Real-Time Traffic

### `class ConnectionManager`
Think of this as the "Switchboard Operator."
- `active_connections`: A dictionary that stores the actual "phone line" (WebSocket) for every active user. 
- `broadcast(message)`: A loop that sends a piece of data to **every single line** in the dictionary.
- `send_personal_message(message, username)`: Looks up the specific user in the dictionary and sends the data only to them.

### `@app.websocket("/ws/{username}")`
This is an asynchronous loop that stays open forever.
1. **Receive**: `data = await websocket.receive_text()`.
2. **Decode**: It turns the incoming string into a Python dictionary using `json.loads()`.
3. **Persist**: Before sending the message to anyone, it writes it to the SQLite database.
4. **Route**:
    - **Global**: Calls `manager.broadcast()`.
    - **Private**: Calls `manager.send_personal_message()` for the recipient **and** for the sender (so the sender sees their own message appear).

---

## 5. Deployment Shims

- **`app.py`**: Hugging Face Spaces expects a file named `app.py`. Instead of rewriting everything, this script simply uses `subprocess` to trigger the `uvicorn` command that starts our real server.
- **`Procfile`**: For Railway/Heroku. It defines the "web" process. If the server crashes, Railway sees this and uses it to automatically restart the app.

---
*Documented by Antigravity.*
