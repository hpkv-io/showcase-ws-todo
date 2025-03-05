# HPKV WebSocket Implementation Showcase

A technical demonstration of HPKV's WebSocket-based API through a todo application. This showcase illustrates how WebSocket can be used as an efficient communication protocol for key-value store operations and how to build a simple and responsive, multi-user application using HPKV's WebSocket API.

[Live Demo](https://showcase-todo.hpkv.io/)

![Screenshot](/images/screenshot-darkmode.png)

## Why WebSocket for HPKV Users

### Development Benefits
1. **Simplified Integration**:
   ```javascript
   // One-time setup
   const ws = new WebSocket(`wss://${region}/ws?apiKey=${apiKey}`);
   
   // All operations use the same connection
   ws.send({ op: OP_GET, key: 'key1' });
   ws.send({ op: OP_INSERT, key: 'key2', value: 'data' });
   ```

2. **Real-time Key Monitoring (Pub-Sub)**:
   ```javascript
   // Generate a monitoring token for multiple keys
   const token = await fetch(`https://${region}/token/websocket`, {
     method: 'POST',
     headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
     body: JSON.stringify({ subscribeKeys: ['todos-20240305', 'todos-20240306'] })
   }).then(res => res.json()).then(data => data.token);
   
   // Connect monitoring WebSocket
   const monitorWs = new WebSocket(`wss://${region}/ws?token=${token}`);
   
   // Handle notifications
   monitorWs.onmessage = (event) => {
     const notification = JSON.parse(event.data);
     if (notification.type === 'notification') {
       // Process the complete todo list update
       const todos = JSON.parse(notification.value);
       updateUI(todos);
     }
   };
   ```

3. **Reduced Code Complexity**:
   Without WebSocket, applications need to handle:
   - New HTTP connection for each operation
   - API key in headers for each request
   - Connection error handling for each request
   - Request timeout management
   - Response status code handling

4. **Built-in Connection Management**:
   ```javascript
   ws.onclose = () => {
     authScreen.classList.remove('hidden');
     todoScreen.classList.add('hidden');
     alert('WebSocket connection closed. Please reconnect.');
   };

   ws.onerror = (error) => {
     console.error('WebSocket error:', error);
     alert('Failed to connect. Please check your API key and try again.');
   };
   ```

### Performance Benefits
1. **Lower Latency**:
   - No TCP handshake per operation
   - No HTTP header overhead
   - Reduced network round trips

2. **Efficient for High-Frequency Operations**:
   ```javascript
   // Single operation for the entire todo list
   const todos = [...existingTodos, newTodo];
   sendMessage(OP_INSERT, `todos-${activeDate}`, JSON.stringify(todos));
   ```

## Implementation Example

### Message Protocol
```javascript
// Operation codes
const OP_GET = 1;
const OP_INSERT = 2;
const OP_UPDATE = 3;
const OP_DELETE = 4;

// Message structure
{
    op: OP_CODE,        // Required: Operation to perform
    key: string,        // Required: Key to operate on
    value?: string,     // Required for INSERT/UPDATE, ignored for GET/DELETE
    timestamp?: number, // Optional
    messageId?: number  // Optional: For response tracking and deduplication
}
```

### State Synchronization
```javascript
// Set up WebSocket monitoring for all visible days
setupMonitoring();

// Handle updates via pub-sub
monitorWs.onmessage = (event) => {
    const notification = JSON.parse(event.data);
    if (notification.type === 'notification') {
        const { key, value } = notification;
        
        // Update the UI if this is the active day
        if (key === `todos-${activeDate}`) {
            refreshTodoList(value);
        }
        
        // Cache the updated value
        todoCache.set(key, value);
    }
};
```

## Technical Considerations

### Advantages for Users
1. **Simplified Development**:
   - Single connection setup
   - Consistent message format
   - Simple error handling
   - Automatic message ID tracking

2. **Better Performance**:
   - Lower latency operations
   - Reduced bandwidth usage
   - Efficient for frequent operations
   - Single key per day reduces key space

## Files
- `index.html`: Application structure
- `styles.css`: UI styling
- `app.js`: WebSocket implementation example

## Implementation Notes

### WebSocket Usage
While WebSocket is typically known for bidirectional communication, HPKV's implementation offers two patterns:

1. **RPC Pattern (Command WebSocket)**:
   - All updates are client-initiated
   - Used for standard CRUD operations (GET, INSERT, UPDATE, DELETE)
   - Returns response for each operation

2. **Pub-Sub Pattern (Monitoring WebSocket)**:
   - Real-time key change notifications
   - Server pushes updates when monitored keys change
   - Efficient for detecting changes without polling
   - Monitors all visible days simultaneously

### Todo App Implementation
The todo application demonstrates these patterns:

1. **Data Structure**:
   ```javascript
   // Each day's todos are stored as a single key with an array value:
   todos-2024-03-05: [
     {
       id: "todo_1708291200000_123",
       text: "Buy groceries",
       priority: "high",
       status: "not set",
       created: 1708291200000
     },
     {
       id: "todo_1708291245000_456",
       text: "Call dentist",
       priority: "low",
       status: "done",
       created: 1708291245000
     }
   ]
   ```

2. **State Management**:
   - Client maintains a local cache of todos by day
   - Uses WebSocket pub-sub to monitor all visible days in real-time
   - When a day's todo list changes, receives the complete updated list
   - Updates local state and UI immediately upon receiving notification

3. **Operations Flow**:
   ```mermaid
   sequenceDiagram
       participant C as Client
       participant WS as WebSocket
       participant MWS as Monitor WebSocket
       participant HPKV as HPKV

       %% Setup monitoring
       Note over C,HPKV: Setup Key Monitoring
       C->>HPKV: POST /token/websocket (subscribe to all visible days)
       HPKV-->>C: token
       C->>MWS: Connect with token
       MWS-->>C: Connection established

       %% Adding new todo
       Note over C,HPKV: Adding New Todo
       C->>WS: GET todos-2024-03-05
       WS->>HPKV: Get todos
       HPKV-->>WS: [existing todos]
       WS-->>C: [existing todos]
       C->>WS: INSERT todos-2024-03-05 ([...existing, newTodo])
       WS->>HPKV: Insert updated array
       HPKV-->>WS: Success
       WS-->>C: Success

       %% Real-time updates via monitoring
       Note over C,HPKV: Real-time Updates
       HPKV->>MWS: Notification: todos-2024-03-05 updated
       MWS->>C: Notification with complete todo list
       C-->C: Update UI with new data
   ```

## License
MIT 