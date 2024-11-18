// mqttServer.js

const admin = require('firebase-admin');
const aedes = require('aedes')();
const http = require('http');
const ws = require('websocket-stream');
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

// Create and start the MQTT broker over WebSockets
const brokerPort = process.env.PORT || 3000; // Use Heroku's assigned port
const server = http.createServer();

// Parse the VALID_USERS environment variable
const validUsers = JSON.parse(process.env.VALID_USERS || '{}');

// Add authentication to the MQTT broker
aedes.authenticate = (client, username, password, callback) => {
  const isValidUser = validUsers[username] && validUsers[username] === password.toString();
  if (isValidUser) {
    callback(null, true);
  } else {
    const error = new Error('Authentication Failed');
    error.returnCode = 4; // MQTT 3.1.0: Bad username or password
    callback(error, false);
  }
};

// Connect broker to websockets
ws.createServer({ server }, aedes.handle);

server.listen(brokerPort, function () {
  console.log('MQTT broker over WebSockets started and listening on port', brokerPort);
});

// Firebase database reference
const db = admin.database();
const ref = db.ref('/beacons');

// Publish Firebase updates to the MQTT broker
ref.on('value', (snapshot) => {
  const data = snapshot.val();
  aedes.publish({ topic: 'beacon_users', payload: JSON.stringify(data) });
});


