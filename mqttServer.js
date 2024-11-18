// mqttServer.js

const admin = require('firebase-admin');
const aedes = require('aedes')();
const net = require('net');
if (process.env.NODE_ENV !== 'prod') {
    require('dotenv').config();
}

// Parse the JSON string from the environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://spatialmedia-22177-default-rtdb.firebaseio.com/'
});

// Create and start the MQTT broker
const brokerPort = 1883;
const server = net.createServer(aedes.handle);

server.listen(brokerPort, function () {
  console.log('MQTT broker started and listening on port', brokerPort);
});

// Firebase database reference
const db = admin.database();
const ref = db.ref('/beacons');

// Publish Firebase updates to the MQTT broker
ref.on('value', (snapshot) => {
  const data = snapshot.val();
  aedes.publish({ topic: 'beacon_users', payload: JSON.stringify(data) });
});
