# HPKV WebSocket Implementation Showcase

A technical demonstration of HPKV's WebSocket-based API through a todo application. This showcase illustrates how WebSocket can be used as an efficient communication protocol for key-value store operations.

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

2. **Reduced Code Complexity**:
   Without WebSocket, applications need to handle:
   - New HTTP connection for each operation
   - API key in headers for each request
   - Connection error handling for each request
   - Request timeout management
   - Response status code handling

3. **Built-in Connection Management**:
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
   // Multiple operations without connection overhead
   sendMessage(OP_INSERT, `${activeDate}-${newCount}`, todo);
   sendMessage(OP_INSERT, `${activeDate}-count`, newCount.toString());
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
// Simple polling for updates
pollInterval = setInterval(fetchTodos, 2000);

// Handle updates
ws.onmessage = async (event) => {
    const response = JSON.parse(event.data);
    if (response.code === 200) {
        updateLocalState(response.key, response.value);
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

## Files
- `index.html`: Application structure
- `styles.css`: UI styling
- `app.js`: WebSocket implementation example

## Implementation Notes

### WebSocket Usage
While WebSocket is typically known for bidirectional communication, HPKV's implementation uses it as an efficient RPC protocol:
- No server-push capability
- All updates are client-initiated
- State synchronization uses polling (2-second interval)

### Todo App Implementation
The todo application demonstrates this pattern:

1. **Data Structure**:
   ```javascript
   // Each day's todos are stored as:
   ${date}-count: "3"    // Number of todos
   
   ${date}-1: {         // Individual todos
     text: "Buy groceries",
     priority: "high",
     status: "not set",
     created: 1708291200000,
     isDeleted: false
   }
   
   ${date}-2: {
     text: "Call dentist",
     priority: "low",
     status: "done",
     created: 1708291245000,
     isDeleted: false
   }
   ```

2. **State Management**:
   - Client maintains a local cache of todos
   - Polls server every 2 seconds for updates
   - Updates local state when changes are detected

3. **Operations Flow**:
   ```mermaid
   sequenceDiagram
       participant C as Client
       participant WS as WebSocket
       participant HPKV as HPKV

       %% Adding new todo
       Note over C,HPKV: Adding New Todo
       C->>WS: GET ${date}-count
       WS->>HPKV: Get count
       HPKV-->>WS: count="2"
       WS-->>C: count="2"
       C->>WS: INSERT ${date}-3 (new todo)
       WS->>HPKV: Insert todo
       HPKV-->>WS: Success
       WS-->>C: Success
       C->>WS: INSERT ${date}-count="3"
       WS->>HPKV: Update count
       HPKV-->>WS: Success
       WS-->>C: Success

       %% Polling for updates
       Note over C,HPKV: Polling for Updates
       C->>WS: GET ${date}-count
       WS->>HPKV: Get count
       HPKV-->>WS: count="3"
       WS-->>C: count="3"
       C->>WS: GET ${date}-1,2,3
       WS->>HPKV: Get todos
       HPKV-->>WS: Todo objects
       WS-->>C: Todo objects
   ```

This implementation showcases how to build a responsive, multi-user application using HPKV's WebSocket API, even without true server-push capabilities.

## License
MIT 