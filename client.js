/*
 * Lambda Chat client script
 * connect a client to the Lambda Chat room
 * config format:
    {
        username: string(required), // username to appear as in chat
        msgBoxId: string(required), // container to display messages
        inputId: string(required), // message input
        sigSrv: string(required), // websocket url to signaling server (server.js)
        loggingCallback: function(optional) //callback to send logs to. args: (level, message)
    }
 */

const initP2PChat = (config) => {
    // Validate config
    if (!config.username || !config.msgBoxId || !config.inputId || !config.sigSrv) {
        throw new Error('Missing required configuration parameters');
    }

    // Internal state
    const state = {
        peerConnections: new Map(), // peerId -> RTCPeerConnection
        dataChannels: new Map(),    // peerId -> RTCDataChannel
        peerUsernames: new Map(),   // peerId -> username
        myPeerId: null,
        config: {
            ...config,
            loggingCallback: config.loggingCallback || console.log
        }
    };

    // Logging helper
    const log = (level, message) => {
        state.config.loggingCallback(level, message);
    };

    // WebRTC configuration
    const rtcConfig = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    // DOM elements
    const messagesElement = document.querySelector(state.config.msgBoxId);
    const inputElement = document.querySelector(state.config.inputId);
    const buttonElement = document.querySelector(state.config.buttonId);

    if (!messagesElement || !inputElement || !buttonElement) {
        throw new Error('Could not find required DOM elements');
    }

    // Connect to signaling server
    const ws = new WebSocket(config.sigSrv);

    ws.onopen = () => {
        // Register username with server
        ws.send(JSON.stringify({
            type: 'register',
            username: state.config.username
        }));
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        log('debug', `Received message: ${JSON.stringify(data)}`);

        if (!state.myPeerId && data.senderId) {
            state.myPeerId = data.senderId;
        }

        switch(data.type) {
            case 'existing-peers':
                for (const peer of data.peers) {
                    state.peerUsernames.set(peer.clientId, peer.username);
                    await createPeerConnection(peer.clientId, true);
                }
                break;
            case 'new-peer':
                state.peerUsernames.set(data.peerId, data.username);
                await createPeerConnection(data.peerId, false);
                break;
            case 'offer':
                state.peerUsernames.set(data.senderId, data.username);
                await handleOffer(data);
                break;
            case 'answer':
                await handleAnswer(data);
                break;
            case 'ice-candidate':
                await handleIceCandidate(data);
                break;
            case 'peer-disconnected':
                handlePeerDisconnection(data.peerId, data.username);
                break;
        }
    };

    async function createPeerConnection(peerId, initiator) {
        const peerConnection = new RTCPeerConnection(rtcConfig);
        state.peerConnections.set(peerId, peerConnection);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    targetPeerId: peerId
                }));
            }
        };

        if (initiator) {
            const dataChannel = peerConnection.createDataChannel('chat');
            setupDataChannel(dataChannel, peerId);
        } else {
            peerConnection.ondatachannel = (event) => {
                setupDataChannel(event.channel, peerId);
            };
        }

        if (initiator) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            ws.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                targetPeerId: peerId
            }));
        }

        return peerConnection;
    }

    async function handleOffer(data) {
        const peerId = data.senderId;
        let peerConnection = state.peerConnections.get(peerId);

        if (!peerConnection) {
            peerConnection = await createPeerConnection(peerId, false);
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            targetPeerId: peerId
        }));
    }

    async function handleAnswer(data) {
        const peerConnection = state.peerConnections.get(data.senderId);
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (e) {
                log('error', `Error setting remote description: ${e.message}`);
            }
        }
    }

    async function handleIceCandidate(data) {
        const peerConnection = state.peerConnections.get(data.senderId);
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                log('error', `Error adding received ice candidate: ${e.message}`);
            }
        }
    }

    function setupDataChannel(channel, peerId) {
        state.dataChannels.set(peerId, channel);

        channel.onopen = () => {
            const peerUsername = state.peerUsernames.get(peerId);
            log('info', `Data channel to ${peerUsername} (${peerId}) opened`);
        };

        channel.onclose = () => {
            const peerUsername = state.peerUsernames.get(peerId);
            log('info', `Data channel to ${peerUsername} (${peerId}) closed`);
            state.dataChannels.delete(peerId);
        };

        channel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            appendMessage(data.message, data.username);
        };
    }

    function handlePeerDisconnection(peerId, username) {
        const connection = state.peerConnections.get(peerId);
        if (connection) {
            connection.close();
            state.peerConnections.delete(peerId);
        }
        state.dataChannels.delete(peerId);
        state.peerUsernames.delete(peerId);
        log('info', `Peer ${username} (${peerId}) disconnected`);
    }

    function sendMessage() {
        const message = inputElement.value.trim();
        
        if (message) {
            const messageData = {
                message: message,
                senderId: state.myPeerId,
                username: state.config.username
            };

            state.dataChannels.forEach(channel => {
                if (channel.readyState === 'open') {
                    channel.send(JSON.stringify(messageData));
                }
            });
            
            appendMessage(message, state.config.username);
            inputElement.value = '';
        }
    }

    function appendMessage(message, username) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';

        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'username';
        usernameSpan.textContent = `${username}:`;

        const messageSpan = document.createElement('span');
        messageSpan.textContent = ` ${message}`;

        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(messageSpan);
        messagesElement.appendChild(messageDiv);
        messagesElement.scrollTop = messagesElement.scrollHeight;
    }
    inputElement.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    buttonElement.addEventListener('click', sendMessage);
};