// mqttServer.js

const admin = require('firebase-admin');
const mqtt = require('mqtt');
const http = require('http');
if (process.env.NODE_ENV !== 'prod') {
    require('dotenv').config();
}

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://spatialmedia-22177-default-rtdb.firebaseio.com/'
});

// Connect to the existing MQTT broker with authentication
const mqttBrokerUrl = process.env.MQTT_BROKER_URL;
const mqttClient = mqtt.connect(mqttBrokerUrl, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});

// Firebase database reference
const db = admin.database();
const ref = db.ref('/beacons');

// Publish Firebase updates to the MQTT broker
ref.on('value', (snapshot) => {
  const data = snapshot.val();
  mqttClient.publish('sebschlo/feeds/beacon-users', JSON.stringify(data), (err) => {
    if (err) {
      console.error('Failed to publish message:', err);
    } else {
      console.log('Message published to topic beacon_users');
    }
  });
});

// Handle connection events
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

// Add a simple HTTP server to bind to the required port
const PORT = process.env.PORT || 3000; // Use the PORT environment variable or default to 3000

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('MQTT Server is running\n');
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
