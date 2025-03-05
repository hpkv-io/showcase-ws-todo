// Operation codes from HPKV API
const OP_GET = 1;
const OP_INSERT = 2;
const OP_UPDATE = 3;
const OP_DELETE = 4;

// Constants
const THEME_KEY = 'hpkv-theme-preference';
const API_KEY = 'hpkv-api-key';
const REGION_KEY = 'hpkv-region';
const UPDATE_DEBOUNCE = 1000;

// Check if we're running locally
const isLocalhost = window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   window.location.hostname === '';

// App state
let ws = null;
let monitorWs = null; // WebSocket for key monitoring
let selectedPriority = 'low';
let messageId = 1;
let isAddingTodo = false;
let todoCache = new Map(); // Cache to track todos by day
let lastUpdateTime = 0;
let lastMessageIds = new Set(); // Track our own message IDs
let activeDay = null;
let monitorToken = null; // Token for key monitoring
let visibleDays = []; // Track visible days for monitoring

// Function to get a date formatted as a key
function getDateKey(date) {
    return `todos-${date}`;
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const themeToggle = document.querySelector('.theme-toggle');
    const logoutBtn = document.querySelector('.logout-btn');
    const htmlElement = document.documentElement;
    const authScreen = document.getElementById('auth-screen');
    const todoScreen = document.getElementById('todo-screen');
    const apiKeyInput = document.getElementById('api-key');
    const regionSelect = document.getElementById('region-select');
    const connectBtn = document.getElementById('connect-btn');
    const daysContainer = document.querySelector('.days-container');

    // Handle localhost option visibility
    const localhostOption = regionSelect.querySelector('option[value="localhost:3000"]');
    if (!isLocalhost) {
        localhostOption.remove();
    }

    // Load saved theme preference
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    htmlElement.setAttribute('data-theme', savedTheme);

    // Load saved API key and region
    const savedApiKey = localStorage.getItem(API_KEY);
    const savedRegion = localStorage.getItem(REGION_KEY);

    if (savedApiKey && savedRegion) {
        // Set the values
        apiKeyInput.value = savedApiKey;
        regionSelect.value = savedRegion;
        
        // Wait a small bit for everything to be ready
        setTimeout(() => {
            // Only auto-connect if we're still on the auth screen
            if (!authScreen.classList.contains('hidden')) {
                connectBtn.click(); // Auto-connect
            }
        }, 100);
    }

    // Theme toggle
    themeToggle.addEventListener('click', () => {
        const currentTheme = htmlElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(THEME_KEY, newTheme);
    });

    // Logout functionality
    logoutBtn.addEventListener('click', () => {
        // Clear stored credentials
        localStorage.removeItem(API_KEY);
        localStorage.removeItem(REGION_KEY);
        
        // Close WebSocket connections
        if (ws) {
            ws.close();
            ws = null;
        }
        
        if (monitorWs) {
            monitorWs.close();
            monitorWs = null;
        }
        
        // Clear input fields
        apiKeyInput.value = '';
        regionSelect.value = 'api-eu-1.hpkv.io';
        
        // Hide logout button
        logoutBtn.classList.add('hidden');
        
        // Show auth screen
        authScreen.classList.remove('hidden');
        todoScreen.classList.add('hidden');
    });

    // Connect button handler
    connectBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            alert('Please enter an API key');
            return;
        }

        const selectedRegion = regionSelect.value;
        const protocol = selectedRegion === 'localhost:3000' ? 'ws' : 'wss';

        // Save credentials to local storage
        localStorage.setItem(API_KEY, apiKey);
        localStorage.setItem(REGION_KEY, selectedRegion);

        // Connect to WebSocket with API key as query parameter
        ws = new WebSocket(`${protocol}://${selectedRegion}/ws?apiKey=${apiKey}`);

        ws.onopen = async () => {
            authScreen.classList.add('hidden');
            todoScreen.classList.remove('hidden');
            logoutBtn.classList.remove('hidden'); // Show logout button
            
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
            
            // Set up monitoring for today's todo count instead of polling
            setupMonitoring();
        };

        ws.onclose = () => {
            // Close monitoring WebSocket if exists
            if (monitorWs) {
                monitorWs.close();
                monitorWs = null;
            }
            
            authScreen.classList.remove('hidden');
            todoScreen.classList.add('hidden');
            logoutBtn.classList.add('hidden'); // Hide logout button
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
            const dateKey = getDateKey(activeDate);
            
            // Skip processing only if this is our own recent update
            if (lastMessageIds.has(response.messageId) && Date.now() - lastUpdateTime < UPDATE_DEBOUNCE) {
                console.log('Skipping our own update:', response.messageId);
                return;
            }

            console.log('Received message:', response);

            if (response.code !== 200) {
                if (response.code === 404) {
                    if (response.key === dateKey) {
                        // No todos exist yet for this day
                        console.log('No todos found for day:', activeDate);
                        const todoList = getTodoList();
                        if (todoList) {
                            todoList.innerHTML = '';
                        }
                        
                        // If we're adding a todo, create the first todo
                        if (isAddingTodo) {
                            const newInput = getNewTodoInput();
                            if (newInput) {
                                addTodo(newInput.value.trim());
                            }
                        }
                    }
                    return;
                }
                console.error('Error:', response.error);
                isAddingTodo = false;
                return;
            }

            // Handle todos response
            if (response.key === dateKey) {
                if (response.value) {
                    // Save in cache
                    todoCache.set(dateKey, response.value);
                    
                    // Update UI
                    refreshTodoList(response.value);
                } else {
                    // Empty todos
                    const todoList = getTodoList();
                    if (todoList) {
                        todoList.innerHTML = '';
                    }
                }
                return;
            }
        };
    });

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

    function createTodoElement(todo, isNew = true, isUpdate = false) {
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

    function sendMessage(op, key, value = '', timestamp = Date.now()) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }
        
        const id = messageId++;
        const message = {
            op,
            key,
            value: value && typeof value !== 'string' ? JSON.stringify(value) : value,
            timestamp
        };
        
        // Track our own message IDs to avoid duplicate processing
        lastMessageIds.add(id);
        message.messageId = id;
        
        // Cleanup old message IDs (keep only the last 50)
        if (lastMessageIds.size > 50) {
            const oldestId = [...lastMessageIds][0];
            lastMessageIds.delete(oldestId);
        }
        
        ws.send(JSON.stringify(message));
    }

    // Generate a WebSocket token for key monitoring
    async function generateMonitorToken(subscribeDays) {
        try {
            // Convert dates to proper key format
            const subscribeKeys = subscribeDays.map(date => getDateKey(date));
            
            const selectedRegion = localStorage.getItem(REGION_KEY);
            const apiKey = localStorage.getItem(API_KEY);
            const protocol = selectedRegion === 'localhost:3000' ? 'http' : 'https';
            
            console.log('Generating monitoring token for keys:', subscribeKeys);
            
            const response = await fetch(`${protocol}://${selectedRegion}/token/websocket`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subscribeKeys })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to generate token: ${response.status}`);
            }
            
            const data = await response.json();
            return data.token;
        } catch (error) {
            console.error('Error generating monitor token:', error);
            return null;
        }
    }

    async function fetchTodos() {
        const now = Date.now();
        // Skip fetching if we just made an update ourselves
        if (now - lastUpdateTime < UPDATE_DEBOUNCE && lastMessageIds.size > 0) {
            return;
        }
        
        if (!activeDay) return;
        
        const activeDate = activeDay.dataset.day;
        const dateKey = getDateKey(activeDate);
        
        console.log('Fetching todos for:', activeDate);
        sendMessage(OP_GET, dateKey);
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
        const dateKey = getDateKey(activeDate);
        
        isAddingTodo = true;
        
        // Get existing todos or create empty array
        const existingTodosStr = todoCache.get(dateKey);
        let todos = [];
        
        if (existingTodosStr) {
            try {
                todos = JSON.parse(existingTodosStr);
                if (!Array.isArray(todos)) {
                    todos = [];
                }
            } catch (e) {
                console.error('Error parsing todos:', e);
            }
        }
        
        // Generate a unique ID for the new todo
        const id = `todo_${timestamp}_${Math.floor(Math.random() * 1000)}`;
        
        // Create new todo
        const newTodo = {
            id,
            text: text.trim(),
            priority: selectedPriority,
            status: 'not set',
            created: timestamp
        };
        
        // Add to array
        todos.push(newTodo);
        
        // Save updated todos
        const todosJson = JSON.stringify(todos);
        sendMessage(OP_INSERT, dateKey, todosJson, timestamp);
        
        // Update cache immediately
        todoCache.set(dateKey, todosJson);
        
        // Update UI immediately without waiting for server response
        const todoList = getTodoList();
        if (todoList) {
            todoList.appendChild(createTodoElement(newTodo, true));
            sortTodos();
        }
        
        // Reset state
        isAddingTodo = false;
        lastUpdateTime = timestamp;
        
        // Clear input
        const input = getNewTodoInput();
        if (input) {
            input.value = '';
        }
    }

    function toggleTodo(id, isDone) {
        if (!activeDay) return;
        const activeDate = activeDay.dataset.day;
        const dateKey = getDateKey(activeDate);
        const timestamp = Date.now();
        
        // Get the current todos from cache
        const cachedTodosStr = todoCache.get(dateKey);
        if (!cachedTodosStr) {
            console.error('No todos in cache for day:', activeDate);
            return;
        }
        
        try {
            // Parse todos
            const todos = JSON.parse(cachedTodosStr);
            if (!Array.isArray(todos)) {
                console.error('Invalid todos format in cache');
                return;
            }
            
            // Find the todo to update
            const todoIndex = todos.findIndex(todo => todo.id === id);
            if (todoIndex === -1) {
                console.error('Todo not found:', id);
                return;
            }
            
            // Update the todo status
            const todo = todos[todoIndex];
            const currentStatus = todo.status;
            todo.status = currentStatus === 'done' ? 'not set' : 'done';
            
            // Update the todos array
            todos[todoIndex] = todo;
            
            // Save updated todos
            const todosJson = JSON.stringify(todos);
            sendMessage(OP_INSERT, dateKey, todosJson, timestamp);
            
            // Update UI immediately
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
            
            // Update cache immediately
            todoCache.set(dateKey, todosJson);
            lastUpdateTime = timestamp;
            
            // Sort todos after status change
            sortTodos();
        } catch (error) {
            console.error('Error updating todo:', error);
        }
    }

    function deleteTodo(id) {
        if (!activeDay) return;
        const activeDate = activeDay.dataset.day;
        const dateKey = getDateKey(activeDate);
        const timestamp = Date.now();
        
        // Get the current todos from cache
        const cachedTodosStr = todoCache.get(dateKey);
        if (!cachedTodosStr) {
            console.error('No todos in cache for day:', activeDate);
            return;
        }
        
        try {
            // Parse todos
            const todos = JSON.parse(cachedTodosStr);
            if (!Array.isArray(todos)) {
                console.error('Invalid todos format in cache');
                return;
            }
            
            // Find the todo to delete
            const todoIndex = todos.findIndex(todo => todo.id === id);
            if (todoIndex === -1) {
                console.error('Todo not found:', id);
                return;
            }
            
            // Option 1: Mark as deleted but keep in array
            // todos[todoIndex].isDeleted = true;
            
            // Option 2: Remove from array completely
            todos.splice(todoIndex, 1);
            
            // Save updated todos
            const todosJson = JSON.stringify(todos);
            sendMessage(OP_INSERT, dateKey, todosJson, timestamp);
            
            // Update UI immediately
            const todoList = getTodoList();
            if (todoList) {
                const todoElement = todoList.querySelector(`[data-id="${id}"]`);
                if (todoElement) {
                    todoElement.remove();
                }
            }
            
            // Update cache immediately
            todoCache.set(dateKey, todosJson);
            lastUpdateTime = timestamp;
        } catch (error) {
            console.error('Error deleting todo:', error);
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
                        
                        // Close monitoring WebSocket when no day is active
                        if (monitorWs) {
                            monitorWs.close();
                            monitorWs = null;
                        }
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
                        
                        // Fetch todos immediately for the active day
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
        const daySections = document.querySelectorAll('.day-section');
        
        // Set up monitoring for all visible days
        setupMonitoring();
        
        return daySections;
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

    // Setup WebSocket monitoring for all visible days
    async function setupMonitoring() {
        // Close existing monitoring WebSocket if exists
        if (monitorWs) {
            monitorWs.close();
            monitorWs = null;
        }
        
        // Get all day sections and collect their dates
        const dayElements = document.querySelectorAll('.day-section');
        visibleDays = Array.from(dayElements).map(day => day.dataset.day);
        
        if (visibleDays.length === 0) {
            console.log('No visible days to monitor');
            return;
        }
        
        console.log('Setting up monitoring for days:', visibleDays);
        
        // Generate a monitoring token for all days
        const token = await generateMonitorToken(visibleDays);
        if (!token) {
            console.error('Failed to generate monitoring token');
            return;
        }
        
        monitorToken = token;
        const selectedRegion = localStorage.getItem(REGION_KEY);
        const protocol = selectedRegion === 'localhost:3000' ? 'ws' : 'wss';
        
        // Connect to the monitoring WebSocket
        monitorWs = new WebSocket(`${protocol}://${selectedRegion}/ws?token=${token}`);
        
        monitorWs.onopen = () => {
            console.log('Connected to HPKV monitoring service for days:', visibleDays);
            
            // Do initial fetch for the active day
            if (activeDay) {
                fetchTodos();
            }
        };
        
        monitorWs.onmessage = (event) => {
            try {
                const notification = JSON.parse(event.data);
                console.log('Received notification:', notification);
                
                if (notification.type === 'notification') {
                    const { key, value } = notification;
                    
                    // Extract date from key (todos-YYYY-MM-DD)
                    const dateMatch = key.match(/^todos-(.+)$/);
                    if (!dateMatch) return;
                    
                    const date = dateMatch[1];
                    console.log(`Received update for day: ${date}`);
                    
                    // Store updated todos in cache
                    todoCache.set(key, value);
                    
                    // If this is the active day, update the UI
                    if (activeDay && activeDay.dataset.day === date) {
                        refreshTodoList(value);
                    }
                }
            } catch (error) {
                console.error('Error processing notification:', error);
            }
        };
        
        monitorWs.onerror = (error) => {
            console.error('Monitoring WebSocket error:', error);
        };
        
        monitorWs.onclose = () => {
            console.log('Monitoring WebSocket closed');
            monitorWs = null;
        };
    }

    // Function to refresh the todo list with updated data
    function refreshTodoList(todosJson) {
        if (!activeDay) return;
        
        try {
            const todoList = getTodoList();
            if (!todoList) return;
            
            // Clear the current list
            todoList.innerHTML = '';
            
            // Parse todos if it's a string
            const todos = typeof todosJson === 'string' ? JSON.parse(todosJson) : todosJson;
            
            // If no todos or empty array, nothing to render
            if (!todos || !Array.isArray(todos) || todos.length === 0) {
                return;
            }
            
            // Add each todo to the list
            todos.forEach(todo => {
                todoList.appendChild(createTodoElement(todo, false));
            });
            
            // Sort todos
            sortTodos();
        } catch (error) {
            console.error('Error refreshing todo list:', error);
        }
    }
});