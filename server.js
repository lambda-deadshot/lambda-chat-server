const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Store client information
let nextClientId = 1;
const clients = new Map(); // Map to store clientId -> {ws, username}

wss.on('connection', (ws) => {
    const clientId = nextClientId++;
    
    // Wait for initial username message before adding to active clients
    ws.once('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Expect first message to be a username registration
            if (data.type !== 'register') {
                ws.close();
                return;
            }

            const username = data.username;
            
            // Store client information
            clients.set(clientId, {
                ws,
                username,
                clientId
            });
            
            ws.clientId = clientId;
            console.log(`Client ${clientId} (${username}) connected`);

            // Send the new peer info about all existing peers
            const existingPeers = Array.from(clients.entries())
                .filter(([id]) => id !== clientId)
                .map(([id, client]) => ({
                    clientId: id,
                    username: client.username
                }));
            
            if (existingPeers.length > 0) {
                ws.send(JSON.stringify({
                    type: 'existing-peers',
                    peers: existingPeers
                }));
            }

            // Notify existing peers about the new peer
            clients.forEach((client, id) => {
                if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify({
                        type: 'new-peer',
                        peerId: clientId,
                        username: username
                    }));
                }
            });

            // Handle subsequent messages
            ws.on('message', (message) => {
                const data = JSON.parse(message);
                
                // Add sender's information to the message
                data.senderId = clientId;
                data.username = username;
                
                // If there's a specific target peer, send only to them
                if (data.targetPeerId) {
                    const targetPeer = clients.get(data.targetPeerId);
                    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                        targetPeer.ws.send(JSON.stringify(data));
                    }
                }
            });
        } catch (error) {
            console.error('Error processing initial message:', error);
            ws.close();
        }
    });

    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client) {
            console.log(`Client ${clientId} (${client.username}) disconnected`);
            clients.delete(clientId);
            
            // Notify remaining clients about peer disconnection
            clients.forEach(remainingClient => {
                if (remainingClient.ws.readyState === WebSocket.OPEN) {
                    remainingClient.ws.send(JSON.stringify({
                        type: 'peer-disconnected',
                        peerId: clientId,
                        username: client.username
                    }));
                }
            });
        }
    });
});

console.log('Signaling server running on ws://localhost:8080');