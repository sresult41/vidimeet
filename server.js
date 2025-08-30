const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Store active users and rooms
const waitingUsers = new Set();
const activeRooms = new Map();
const userSockets = new Map();

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Store socket reference
    userSockets.set(socket.id, socket);
    
    // Handle user joining the matching pool
    socket.on('join-pool', () => {
        if (waitingUsers.size > 0) {
            // Match with another waiting user
            const partnerId = Array.from(waitingUsers)[0];
            waitingUsers.delete(partnerId);
            
            const roomId = uuidv4();
            activeRooms.set(roomId, {
                users: [socket.id, partnerId],
                createdAt: new Date()
            });
            
            // Notify both users about the match
            socket.emit('matched', {
                roomId: roomId,
                partnerId: partnerId
            });
            
            const partnerSocket = userSockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('matched', {
                    roomId: roomId,
                    partnerId: socket.id
                });
            }
            
            console.log(`Matched users ${socket.id} and ${partnerId} in room ${roomId}`);
        } else {
            // Add to waiting list
            waitingUsers.add(socket.id);
            console.log(`User ${socket.id} added to waiting pool`);
        }
    });
    
    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        const room = activeRooms.get(data.roomId);
        if (room && room.users.includes(socket.id)) {
            const partnerId = room.users.find(id => id !== socket.id);
            const partnerSocket = userSockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('offer', {
                    roomId: data.roomId,
                    offer: data.offer,
                    partnerId: socket.id
                });
            }
        }
    });
    
    socket.on('answer', (data) => {
        const room = activeRooms.get(data.roomId);
        if (room && room.users.includes(socket.id)) {
            const partnerId = room.users.find(id => id !== socket.id);
            const partnerSocket = userSockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('answer', {
                    roomId: data.roomId,
                    answer: data.answer
                });
            }
        }
    });
    
    socket.on('ice-candidate', (data) => {
        const room = activeRooms.get(data.roomId);
        if (room && room.users.includes(socket.id)) {
            const partnerId = room.users.find(id => id !== socket.id);
            const partnerSocket = userSockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('ice-candidate', {
                    roomId: data.roomId,
                    candidate: data.candidate
                });
            }
        }
    });
    
    // Handle text messages
    socket.on('message', (data) => {
        const room = activeRooms.get(data.roomId);
        if (room && room.users.includes(socket.id)) {
            const partnerId = room.users.find(id => id !== socket.id);
            const partnerSocket = userSockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('message', {
                    message: data.message
                });
            }
        }
    });
    
    // Handle user reports
    socket.on('report', (data) => {
        console.log(`User ${socket.id} reported user ${data.userId}`);
        // In a real application, you would store this in a database
        // and potentially take action against the reported user
    });
    
    // Handle room leaving
    socket.on('leave-room', (data) => {
        const room = activeRooms.get(data.roomId);
        if (room) {
            const partnerId = room.users.find(id => id !== socket.id);
            if (partnerId) {
                const partnerSocket = userSockets.get(partnerId);
                if (partnerSocket) {
                    partnerSocket.emit('user-disconnected');
                }
            }
            activeRooms.delete(data.roomId);
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove from waiting list
        waitingUsers.delete(socket.id);
        
        // Handle room cleanup
        for (const [roomId, room] of activeRooms.entries()) {
            if (room.users.includes(socket.id)) {
                const partnerId = room.users.find(id => id !== socket.id);
                if (partnerId) {
                    const partnerSocket = userSockets.get(partnerId);
                    if (partnerSocket) {
                        partnerSocket.emit('user-disconnected');
                    }
                }
                activeRooms.delete(roomId);
                break;
            }
        }
        
        // Remove socket reference
        userSockets.delete(socket.id);
    });
    
    // Error handling
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        socket.emit('error', { message: 'An error occurred' });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        waitingUsers: waitingUsers.size,
        activeRooms: activeRooms.size,
        timestamp: new Date().toISOString()
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    res.json({
        totalUsers: userSockets.size,
        waitingUsers: waitingUsers.size,
        activeRooms: activeRooms.size,
        activeConnections: Array.from(activeRooms.values()).flat().length
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Vidimeet server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});

module.exports = { app, server };
