const admin = require('firebase-admin');
const mqtt = require('mqtt');
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

// Connect to MQTT broker
const client = mqtt.connect('mqtt://your-mqtt-broker-url');

const db = admin.database();
const ref = db.ref('/beacons');

ref.on('value', (snapshot) => {
  const data = snapshot.val();
  client.publish('beacon_users', JSON.stringify(data));
});