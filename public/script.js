class Vidimeet {
    constructor() {
        this.socket = io();
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.roomId = null;
        this.partnerId = null;
        this.isConnected = false;
        this.videoEnabled = true;
        this.audioEnabled = true;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketEvents();
    }

    initializeElements() {
        // Video elements
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        
        // Buttons
        this.startChatBtn = document.getElementById('startChatBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.toggleVideoBtn = document.getElementById('toggleVideoBtn');
        this.toggleAudioBtn = document.getElementById('toggleAudioBtn');
        this.reportBtn = document.getElementById('reportBtn');
        this.sendBtn = document.getElementById('sendBtn');
        
        // Inputs
        this.messageInput = document.getElementById('messageInput');
        
        // Status elements
        this.connectionStatus = document.getElementById('connectionStatus');
        this.statusDot = this.connectionStatus.querySelector('.status-dot');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.remoteLabel = document.getElementById('remoteLabel');
        this.chatMessages = document.getElementById('chatMessages');
        this.loadingOverlay = document.getElementById('loadingOverlay');
    }

    setupEventListeners() {
        this.startChatBtn.addEventListener('click', () => this.startChat());
        this.nextBtn.addEventListener('click', () => this.nextStranger());
        this.toggleVideoBtn.addEventListener('click', () => this.toggleVideo());
        this.toggleAudioBtn.addEventListener('click', () => this.toggleAudio());
        this.reportBtn.addEventListener('click', () => this.reportUser());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            console.log('Connected to server');
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
            console.log('Disconnected from server');
        });

        this.socket.on('matched', (data) => {
            this.handleMatch(data);
        });

        this.socket.on('offer', (data) => {
            this.handleOffer(data);
        });

        this.socket.on('answer', (data) => {
            this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });

        this.socket.on('message', (data) => {
            this.displayMessage(data.message, 'remote');
        });

        this.socket.on('user-disconnected', () => {
            this.handleDisconnection();
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showError(error.message || 'An error occurred');
        });
    }

    async startChat() {
        try {
            this.showLoading(true);
            this.startChatBtn.disabled = true;
            
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            this.localVideo.srcObject = this.localStream;
            
            // Join the matching pool
            this.socket.emit('join-pool');
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            this.showError('Could not access camera/microphone. Please check permissions.');
            this.showLoading(false);
            this.startChatBtn.disabled = false;
        }
    }

    async handleMatch(data) {
        this.roomId = data.roomId;
        this.partnerId = data.partnerId;
        
        console.log('Matched with partner:', this.partnerId);
        
        // Create peer connection
        await this.createPeerConnection();
        
        // Add local stream to peer connection
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });
        
        // Create and send offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.socket.emit('offer', {
            roomId: this.roomId,
            offer: offer
        });
        
        this.showLoading(false);
        this.updateUIForConnection(true);
    }

    async handleOffer(data) {
        this.roomId = data.roomId;
        this.partnerId = data.partnerId;
        
        await this.createPeerConnection();
        
        // Add local stream to peer connection
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });
        
        await this.peerConnection.setRemoteDescription(data.offer);
        
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.socket.emit('answer', {
            roomId: this.roomId,
            answer: answer
        });
        
        this.showLoading(false);
        this.updateUIForConnection(true);
    }

    async handleAnswer(data) {
        await this.peerConnection.setRemoteDescription(data.answer);
    }

    async handleIceCandidate(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    async createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.remoteVideo.srcObject = this.remoteStream;
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    roomId: this.roomId,
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.isConnected = true;
                this.remoteLabel.textContent = 'Connected to stranger';
            }
        };
    }

    nextStranger() {
        this.cleanupConnection();
        this.socket.emit('leave-room', { roomId: this.roomId });
        this.socket.emit('join-pool');
        this.showLoading(true);
    }

    handleDisconnection() {
        this.cleanupConnection();
        this.showError('Stranger disconnected');
        this.updateUIForConnection(false);
    }

    cleanupConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }
        
        this.remoteVideo.srcObject = null;
        this.roomId = null;
        this.partnerId = null;
        this.isConnected = false;
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                this.videoEnabled = !videoTrack.enabled;
                videoTrack.enabled = this.videoEnabled;
                this.toggleVideoBtn.querySelector('.icon').textContent = 
                    this.videoEnabled ? '🎥' : '📷';
            }
        }
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                this.audioEnabled = !audioTrack.enabled;
                audioTrack.enabled = this.audioEnabled;
                this.toggleAudioBtn.querySelector('.icon').textContent = 
                    this.audioEnabled ? '🔊' : '🔇';
            }
        }
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (message && this.roomId) {
            this.socket.emit('message', {
                roomId: this.roomId,
                message: message
            });
            this.displayMessage(message, 'local');
            this.messageInput.value = '';
        }
    }

    displayMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    reportUser() {
        if (this.partnerId) {
            if (confirm('Report this user for inappropriate behavior?')) {
                this.socket.emit('report', { userId: this.partnerId });
                this.nextStranger();
                alert('User reported. Connecting to someone new...');
            }
        }
    }

    updateConnectionStatus(connected) {
        this.statusDot.classList.toggle('connected', connected);
        this.statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    updateUIForConnection(connected) {
        this.nextBtn.disabled = !connected;
        this.reportBtn.disabled = !connected;
        this.messageInput.disabled = !connected;
        this.sendBtn.disabled = !connected;
        
        if (connected) {
            this.startChatBtn.style.display = 'none';
        } else {
            this.startChatBtn.style.display = 'block';
            this.startChatBtn.disabled = false;
        }
    }

    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.remove('hidden');
        } else {
            this.loadingOverlay.classList.add('hidden');
        }
    }

    showError(message) {
        alert('Error: ' + message);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.vidimeet = new Vidimeet();
    
    // Check for media support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support video chat. Please use a modern browser like Chrome, Firefox, or Edge.');
        document.getElementById('startChatBtn').disabled = true;
    }
});
