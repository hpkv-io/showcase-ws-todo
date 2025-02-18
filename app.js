// Operation codes from HPKV API
const OP_GET = 1;
const OP_INSERT = 2;
const OP_UPDATE = 3;
const OP_DELETE = 4;

// App state
let ws = null;
let selectedPriority = 'low';
let messageId = 1;
let isAddingTodo = false;
let todoCache = new Map(); // Cache to track todo states
let lastUpdateTime = 0;
let lastMessageIds = new Set(); // Track our own message IDs
const UPDATE_DEBOUNCE = 1000;
let activeDay = null;
let pollInterval = null; // Track polling interval

// Helper functions
function getDateForOffset(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date;
}

function formatDateDisplay(date) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    
    const day = days[date.getDay()];
    const month = months[date.getMonth()];
    const dayOfMonth = date.getDate();
    const year = date.getFullYear();
    
    // Only add time for today
    const isToday = date.toDateString() === new Date().toDateString();
    let timeStr = '';
    
    if (isToday) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';
        const formattedHours = hours % 12 || 12;
        const formattedMinutes = minutes.toString().padStart(2, '0');
        timeStr = ` — ${formattedHours}:${formattedMinutes}${ampm}`;
    }
    
    return {
        dayName: day,
        dateStr: `${month}, ${dayOfMonth} ${year}${timeStr}`,
        isToday,
        isPast: date < new Date().setHours(0, 0, 0, 0)
    };
}

function formatDate(date) {
    return `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
}

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const todoScreen = document.getElementById('todo-screen');
const apiKeyInput = document.getElementById('api-key');
const regionSelect = document.getElementById('region-select');
const connectBtn = document.getElementById('connect-btn');
const daysContainer = document.querySelector('.days-container');

// Helper functions
function createTodoElement(todo, isNew = true, isUpdate = false) {
    // Don't create element if todo is deleted
    if (todo.isDeleted) {
        return null;
    }

    const todoItem = document.createElement('div');
    todoItem.className = `todo-item ${todo.status === 'done' ? 'done' : ''}`;
    
    // Add animation class for both new items and updates
    if (isNew || isUpdate) {
        todoItem.classList.add(isNew ? 'new-item' : 'status-changed');
        // Remove the animation class after it completes
        setTimeout(() => {
            todoItem.classList.remove(isNew ? 'new-item' : 'status-changed');
        }, 300); // matches var(--transition-speed)
    }
    
    todoItem.dataset.id = todo.id;

    const checkbox = document.createElement('div');
    checkbox.className = `todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`;
    checkbox.onclick = () => toggleTodo(todo.id, todo.status !== 'done');

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;

    const priority = document.createElement('span');
    priority.className = `priority-badge priority-${todo.priority}`;
    priority.textContent = todo.priority;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×'; // Using × character as delete icon
    deleteBtn.onclick = () => deleteTodo(todo.id);

    todoItem.appendChild(checkbox);
    todoItem.appendChild(text);
    todoItem.appendChild(priority);
    todoItem.appendChild(deleteBtn);

    return todoItem;
}

// WebSocket message handling
function sendMessage(op, key, value = '', timestamp = Date.now()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const message = {
        op,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : value,
        timestamp,
        messageId: messageId++
    };
    
    // Track our own message IDs
    lastMessageIds.add(message.messageId);
    // Keep only last 100 message IDs to prevent memory growth
    if (lastMessageIds.size > 100) {
        const oldestId = Array.from(lastMessageIds)[0];
        lastMessageIds.delete(oldestId);
    }
    
    ws.send(JSON.stringify(message));
}

async function fetchTodos() {
    const now = Date.now();
    // Skip polling only if we just made an update ourselves
    if (now - lastUpdateTime < UPDATE_DEBOUNCE && lastMessageIds.size > 0) {
        return;
    }
    
    if (!activeDay) return;
    
    const activeDate = activeDay.dataset.day;
    console.log('Fetching todos count for:', activeDate);
    sendMessage(OP_GET, `${activeDate}-count`);
}

function getTodoList() {
    return activeDay ? activeDay.querySelector('.todo-list') : null;
}

function getNewTodoInput() {
    return activeDay ? activeDay.querySelector('.new-todo') : null;
}

function addTodo(text) {
    if (!text.trim() || !activeDay) return;
    
    const activeDate = activeDay.dataset.day;
    const timestamp = Date.now();
    
    isAddingTodo = true;
    
    // Create new todo
    const todo = {
        text: text.trim(),
        priority: selectedPriority,
        status: 'not set',
        created: timestamp,
        isDeleted: false
    };

    // For new days, directly create the first todo
    const todoList = getTodoList();
    if (todoList && todoList.children.length === 0) {
        // Add first todo and set count
        sendMessage(OP_INSERT, `${activeDate}-1`, todo);
        sendMessage(OP_INSERT, `${activeDate}-count`, '1');
        
        // Display the todo immediately
        const newTodo = {
            ...todo,
            id: 1
        };
        
        todoList.appendChild(createTodoElement(newTodo));
        todoCache.set(`${activeDate}-1`, JSON.stringify(newTodo));
        sortTodos();
        
        // Clear input
        const input = getNewTodoInput();
        if (input) {
            input.value = '';
        }
        isAddingTodo = false;
        lastUpdateTime = timestamp;
        return;
    }

    // Get current count for existing days
    sendMessage(OP_GET, `${activeDate}-count`);
}

function toggleTodo(id, isDone) {
    if (!activeDay) return;
    const activeDate = activeDay.dataset.day;
    const timestamp = Date.now();
    
    // Get the current todo from cache if available
    const cachedTodoStr = todoCache.get(`${activeDate}-${id}`);
    if (cachedTodoStr) {
        const todo = JSON.parse(cachedTodoStr);
        const currentStatus = todo.status;
        todo.status = currentStatus === 'done' ? 'not set' : 'done';
        
        // Update the todo
        sendMessage(OP_INSERT, `${activeDate}-${id}`, todo, timestamp);
        
        // Update UI immediately - look within active day's todo list
        const todoList = getTodoList();
        if (todoList) {
            const todoElement = todoList.querySelector(`[data-id="${id}"]`);
            if (todoElement) {
                todoElement.className = `todo-item ${todo.status === 'done' ? 'done' : ''}`;
                const checkbox = todoElement.querySelector('.todo-checkbox');
                if (checkbox) {
                    checkbox.className = `todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`;
                }
            }
        }
        
        // Update cache immediately to prevent flicker
        todoCache.set(`${activeDate}-${id}`, JSON.stringify(todo));
        lastUpdateTime = timestamp;
        
        // Sort todos after status change
        sortTodos();
    } else {
        // Fallback to fetching if not in cache
        sendMessage(OP_GET, `${activeDate}-${id}`);
        
        ws.addEventListener('message', function handler(event) {
            const response = JSON.parse(event.data);
            
            if (response.key === `${activeDate}-${id}` && response.value) {
                // Remove this one-time handler
                ws.removeEventListener('message', handler);
                
                const todo = JSON.parse(response.value);
                const currentStatus = todo.status;
                todo.status = currentStatus === 'done' ? 'not set' : 'done';
                
                // Update the todo
                sendMessage(OP_INSERT, `${activeDate}-${id}`, todo, timestamp);
                lastUpdateTime = timestamp;
            }
        });
    }
}

function deleteTodo(id) {
    if (!activeDay) return;
    const activeDate = activeDay.dataset.day;
    const timestamp = Date.now();
    
    // Get the current todo from cache if available
    const cachedTodoStr = todoCache.get(`${activeDate}-${id}`);
    if (cachedTodoStr) {
        const todo = JSON.parse(cachedTodoStr);
        todo.isDeleted = true;
        
        // Update the todo
        sendMessage(OP_INSERT, `${activeDate}-${id}`, todo, timestamp);
        
        // Update UI immediately
        const todoList = getTodoList();
        if (todoList) {
            const todoElement = todoList.querySelector(`[data-id="${id}"]`);
            if (todoElement) {
                todoElement.remove();
            }
        }
        
        // Update cache immediately
        todoCache.set(`${activeDate}-${id}`, JSON.stringify(todo));
        lastUpdateTime = timestamp;
    } else {
        // Fallback to fetching if not in cache
        sendMessage(OP_GET, `${activeDate}-${id}`);
        
        ws.addEventListener('message', function handler(event) {
            const response = JSON.parse(event.data);
            
            if (response.key === `${activeDate}-${id}` && response.value) {
                // Remove this one-time handler
                ws.removeEventListener('message', handler);
                
                const todo = JSON.parse(response.value);
                todo.isDeleted = true;
                
                // Update the todo
                sendMessage(OP_INSERT, `${activeDate}-${id}`, todo, timestamp);
                lastUpdateTime = timestamp;
            }
        });
    }
}

// Helper functions
function sortTodos() {
    const todoList = getTodoList();
    if (!todoList) return;
    
    const todos = Array.from(todoList.children);
    todos.sort((a, b) => {
        // First sort by status (not done first)
        const aStatus = a.classList.contains('done');
        const bStatus = b.classList.contains('done');
        if (aStatus !== bStatus) {
            return aStatus ? 1 : -1;
        }
        
        // Then sort by priority (high first)
        const aPriority = a.querySelector('.priority-badge').textContent;
        const bPriority = b.querySelector('.priority-badge').textContent;
        if (aPriority !== bPriority) {
            return aPriority === 'high' ? -1 : 1;
        }
        
        // Finally sort by creation time
        const aId = parseInt(a.dataset.id);
        const bId = parseInt(b.dataset.id);
        return aId - bId;
    });
    
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Move elements to the fragment in sorted order
    // This preserves the elements and their state (including animations)
    todos.forEach(todo => fragment.appendChild(todo));
    
    // Replace the contents with the sorted elements
    todoList.appendChild(fragment);
}

// Initialize day sections
function initializeDaysSections() {
    // Clear existing days
    daysContainer.innerHTML = '';
    
    // Create 6 days (-1 to +4)
    for (let i = -1; i <= 4; i++) {
        const date = getDateForOffset(i);
        const { dayName, dateStr, isToday, isPast } = formatDateDisplay(date);
        
        const section = document.createElement('div');
        section.className = `day-section${isToday ? ' today' : ''}${isPast ? ' past' : ''}`;
        section.dataset.day = formatDate(date);
        section.dataset.index = i + 1; // 0 to 5 for gradient
        
        section.innerHTML = `
            <div class="day-header">
                <h1>${dayName}</h1>
                <p class="date">${dateStr}</p>
            </div>
            <div class="todo-list"></div>
            ${!isPast ? `
            <div class="add-todo">
                <div class="input-group">
                    <input type="text" class="new-todo" placeholder="Add a new task...">
                    <button class="add-todo-btn">Add</button>
                </div>
                <div class="priority-selector">
                    <button class="priority-btn" data-priority="low">Low</button>
                    <button class="priority-btn" data-priority="high">High</button>
                </div>
            </div>
            ` : ''}
        `;
        
        daysContainer.appendChild(section);
        
        // Initialize click handlers for all days
        const header = section.querySelector('.day-header');
        header.addEventListener('click', () => {
            console.log('Day header clicked:', section.dataset.day);
            
            // If this section is already active, close it
            if (section.classList.contains('active')) {
                section.classList.remove('active');
                if (activeDay === section) {
                    activeDay = null;
                }
            } else {
                // If there's an active day, remove its active class first
                if (activeDay) {
                    activeDay.classList.remove('active');
                }
                
                // Wait a tiny bit before opening the new section for smoother transition
                setTimeout(() => {
                    section.classList.add('active');
                    activeDay = section;
                    
                    // If this is a non-past day, focus the input
                    if (!section.classList.contains('past')) {
                        const input = section.querySelector('.new-todo');
                        if (input) {
                            input.focus();
                        }
                    }
                    
                    fetchTodos();
                }, 50);
            }
        });
        
        // Initialize add-todo functionality for non-past days
        if (!isPast) {
            initializeDaySection(section);
        }
    }
    
    // Update daySections reference
    return document.querySelectorAll('.day-section');
}

function initializeDaySection(section) {
    const newTodoInput = section.querySelector('.new-todo');
    const addTodoBtn = section.querySelector('.add-todo-btn');
    const priorityBtns = section.querySelectorAll('.priority-btn');
    
    // Initialize priority buttons
    priorityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove selected class from all priority buttons in all sections
            document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedPriority = btn.dataset.priority;
        });
    });
    
    // Select low priority by default
    const lowPriorityBtn = section.querySelector('.priority-btn[data-priority="low"]');
    lowPriorityBtn.classList.add('selected');
    
    // Add todo handlers
    addTodoBtn.addEventListener('click', () => {
        activeDay = section; // Ensure the section is set as active
        const text = newTodoInput.value.trim();
        if (text) {
            addTodo(text);
        }
    });
    
    newTodoInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            activeDay = section; // Ensure the section is set as active
            const text = newTodoInput.value.trim();
            if (text) {
                addTodo(text);
            }
        }
    });

    // Add focus handler to ensure correct active day
    newTodoInput.addEventListener('focus', () => {
        if (activeDay !== section) {
            if (activeDay) {
                activeDay.classList.remove('active');
            }
            section.classList.add('active');
            activeDay = section;
            fetchTodos();
        }
    });
}

// Event Listeners
connectBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        alert('Please enter an API key');
        return;
    }

    const selectedRegion = regionSelect.value;
    const protocol = selectedRegion === 'localhost:3000' ? 'ws' : 'wss';

    // Connect to WebSocket with API key as query parameter
    ws = new WebSocket(`${protocol}://${selectedRegion}/ws?apiKey=${apiKey}`);

    ws.onopen = () => {
        authScreen.classList.add('hidden');
        todoScreen.classList.remove('hidden');
        
        // Initialize days after connection
        const daySections = initializeDaysSections();
        
        // Activate today's section and scroll to it
        const today = daySections[1]; // Index 1 is today (since we start at -1)
        if (today) {
            // Add a small delay to ensure the DOM is ready
            setTimeout(() => {
                today.scrollIntoView({ behavior: 'smooth', block: 'center' });
                today.querySelector('.day-header').click();
            }, 100);
        }
        
        // Start polling
        if (pollInterval) {
            clearInterval(pollInterval);
        }
        pollInterval = setInterval(fetchTodos, 2000);
        fetchTodos(); // Initial fetch
    };

    ws.onclose = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        authScreen.classList.remove('hidden');
        todoScreen.classList.add('hidden');
        alert('WebSocket connection closed. Please reconnect.');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Failed to connect. Please check your API key and try again.');
    };

    ws.onmessage = async (event) => {
        const response = JSON.parse(event.data);
        if (!activeDay) return;
        const activeDate = activeDay.dataset.day;
        
        // Skip processing only if this is our own recent update
        if (lastMessageIds.has(response.messageId) && Date.now() - lastUpdateTime < UPDATE_DEBOUNCE) {
            return;
        }

        // For count responses, compare current state before updating
        if (response.key === `${activeDate}-count` && !isAddingTodo) {
            const todoList = getTodoList();
            if (todoList) {
                const currentCount = parseInt(response.value || '0');
                const currentTodos = todoList.children.length;
                
                // Always fetch if counts don't match or if this is an update from another client
                if (currentCount !== currentTodos || !lastMessageIds.has(response.messageId)) {
                    if (currentCount > 0) {
                        console.log(`Fetching ${currentCount} todos...`);
                        for (let i = 1; i <= currentCount; i++) {
                            sendMessage(OP_GET, `${activeDate}-${i}`);
                        }
                    } else {
                        todoList.innerHTML = '';
                    }
                    return;
                }
            }
        }

        console.log('Received message:', response);

        if (response.code !== 200) {
            if (response.code === 404) {
                if (response.key === `${activeDate}-count`) {
                    // No todos exist yet
                    console.log('No todos found');
                    const todoList = getTodoList();
                    if (todoList) {
                        todoList.innerHTML = '';
                    }
                    if (isAddingTodo) {
                        // This is a new day, create the first todo
                        const todo = {
                            text: getNewTodoInput().value.trim(),
                            priority: selectedPriority,
                            status: 'not set',
                            created: Date.now(),
                            isDeleted: false
                        };
                        
                        // Add first todo and set count
                        sendMessage(OP_INSERT, `${activeDate}-1`, todo);
                        sendMessage(OP_INSERT, `${activeDate}-count`, '1');
                        
                        // Display the todo immediately
                        const newTodo = {
                            ...todo,
                            id: 1
                        };
                        
                        if (todoList) {
                            todoList.appendChild(createTodoElement(newTodo, true)); // This is a new todo
                            todoCache.set(`${activeDate}-1`, JSON.stringify(newTodo));
                            sortTodos();
                        }
                        
                        // Clear input and reset flag
                        const input = getNewTodoInput();
                        if (input) {
                            input.value = '';
                        }
                        isAddingTodo = false;
                        lastUpdateTime = Date.now();
                    }
                    return;
                }
            }
            if (response.code === 409) {
                // There are existing todos, let's get the count and add to it
                console.log('Found existing todos, fetching count...');
                sendMessage(OP_GET, `${activeDate}-count`);
                return;
            }
            console.error('Error:', response.error);
            isAddingTodo = false;
            return;
        }

        // Handle count request for adding new todo
        if (response.key === `${activeDate}-count`) {
            const currentCount = parseInt(response.value || '0');
            console.log(`Current todo count: ${currentCount}`);
            
            if (isAddingTodo) {
                if (!activeDay) {
                    isAddingTodo = false;
                    return;
                }
                
                const newCount = currentCount + 1;
                const timestamp = Date.now();
                
                const todo = {
                    text: getNewTodoInput().value.trim(),
                    priority: selectedPriority,
                    status: 'not set',
                    created: timestamp,
                    isDeleted: false
                };
                
                console.log('Adding new todo:', todo);
                
                // Add new todo
                sendMessage(OP_INSERT, `${activeDate}-${newCount}`, todo, timestamp);
                
                // Update count
                sendMessage(OP_INSERT, `${activeDate}-count`, newCount.toString(), timestamp);
                
                // Display the todo immediately
                const newTodo = {
                    ...todo,
                    id: newCount
                };
                
                const todoList = getTodoList();
                if (todoList) {
                    todoList.appendChild(createTodoElement(newTodo, true)); // This is a new todo
                    todoCache.set(`${activeDate}-${newCount}`, JSON.stringify(newTodo));
                    sortTodos();
                }
                
                // Clear input and reset flag
                const input = getNewTodoInput();
                if (input) {
                    input.value = '';
                }
                isAddingTodo = false;
                lastUpdateTime = timestamp; // Prevent immediate refresh
            } else {
                // This is a regular count check (polling or initial load)
                // Fetch all todos if we have any
                if (currentCount > 0) {
                    console.log(`Fetching ${currentCount} todos...`);
                    for (let i = 1; i <= currentCount; i++) {
                        sendMessage(OP_GET, `${activeDate}-${i}`);
                    }
                }
            }
            return;
        }

        // Handle individual todo responses
        const [date, id] = (response.key || '').split('-');
        if (date && id && id !== 'count') {
            if (response.value) {
                try {
                    const todo = JSON.parse(response.value);
                    todo.id = id;
                    
                    // Check if todo has changed
                    const cachedTodo = todoCache.get(`${date}-${id}`);
                    const todoStr = JSON.stringify(todo);
                    
                    if (!cachedTodo || cachedTodo !== todoStr) {
                        console.log(`Todo ${id} has changed, updating...`);
                        
                        const todoList = getTodoList();
                        if (todoList) {
                            // Remove existing todo if present
                            const existingTodo = todoList.querySelector(`[data-id="${id}"]`);
                            if (existingTodo) {
                                existingTodo.remove();
                            }
                            
                            // Add new/updated todo with animation if it's from another client
                            const isFromOtherClient = !lastMessageIds.has(response.messageId);
                            todoList.appendChild(createTodoElement(todo, false, isFromOtherClient));
                            
                            // Update cache
                            todoCache.set(`${date}-${id}`, todoStr);
                            
                            // Sort todos
                            sortTodos();
                        }
                    }
                } catch (error) {
                    console.error('Error parsing todo:', error);
                }
            }
        }
    };
});