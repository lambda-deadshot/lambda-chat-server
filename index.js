const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Generate unique IDs for each client
let nextClientId = 1;
const clients = new Map(); // Map to store client ID -> WebSocket

wss.on('connection', (ws) => {
    const clientId = nextClientId++;
    clients.set(clientId, ws);
    ws.clientId = clientId;
    console.log(`Client ${clientId} connected`);

    // Send the new peer info about all existing peers
    const existingPeers = Array.from(clients.keys())
        .filter(id => id !== clientId);
    
    if (existingPeers.length > 0) {
        ws.send(JSON.stringify({
            type: 'existing-peers',
            peerIds: existingPeers
        }));
    }

    // Notify existing peers about the new peer
    clients.forEach((client, id) => {
        if (id !== clientId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'new-peer',
                peerId: clientId
            }));
        }
    });

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        // Add sender's ID to the message
        data.senderId = clientId;
        
        // If there's a specific target peer, send only to them
        if (data.targetPeerId) {
            const targetPeer = clients.get(data.targetPeerId);
            if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
                targetPeer.send(JSON.stringify(data));
            }
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`Client ${clientId} disconnected`);
        
        // Notify remaining clients about peer disconnection
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'peer-disconnected',
                    peerId: clientId
                }));
            }
        });
    });
});
console.log('Signaling server running on ws://localhost:8080');