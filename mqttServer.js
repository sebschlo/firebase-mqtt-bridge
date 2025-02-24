// mqttServer.js

const admin = require('firebase-admin');
const mqtt = require('mqtt');
const express = require('express');
const OpenAI = require('openai');
if (process.env.NODE_ENV !== 'prod') {
    require('dotenv').config();
}

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Firebase database references
const db = admin.database();
const beaconsRef = db.ref('/beacons');
const promptsRef = db.ref('/conversation_prompts');

// Firestore reference for user profiles
const firestore = admin.firestore();

// Constants
const PROXIMITY_THRESHOLD = -60; // RSSI threshold for "close" proximity
const CLEANUP_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds

// Generate a conversation starter using OpenAI
async function generateConversationStarter(userProfiles) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a friendly conversation starter generator. Your goal is to find interesting connections between people and suggest engaging topics they might want to discuss."
        },
        {
          role: "user",
          content: `Generate a natural and engaging conversation starter for these people based on their profiles: ${JSON.stringify(userProfiles)}. Keep it casual and friendly, focusing on common interests or complementary experiences. Don't repeat or mention any details from their profile, but rather think about what things they might have in common. Be whimsical and creative with the prompt, and make it really short and punchy. Don't be afraid to go into weird or deep places, this is a social experiment and it should be interesting for the users. If only one person is present, give them a thought provoking question for them to ponder.`
        }
      ],
      max_tokens: 150
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating conversation starter:', error);
    return null;
  }
}

// Clean up old data and return nearby users for a beacon
async function getNearbyUsers(beaconId) {
  const snapshot = await beaconsRef.child(beaconId).child('users').once('value');
  const usersData = snapshot.val();
  if (!usersData) return [];

  const now = Date.now();
  const nearbyUsers = [];

  // Process users data
  Object.values(usersData).forEach((userData) => {
    // Convert timestamp to milliseconds if needed (Firebase sometimes uses seconds)
    const timestamp = userData.timestamp * 1000; // Convert seconds to milliseconds
    
    if (now - timestamp < CLEANUP_THRESHOLD) {
      // Use signalStrength instead of rssi
      if (userData.signalStrength >= PROXIMITY_THRESHOLD) {
        nearbyUsers.push(userData.id);
      }
    }
  });

  // Clean up old data if needed
  if (nearbyUsers.length === 0) {
    await beaconsRef.child(beaconId).remove();
  }

  return nearbyUsers;
}

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
};

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('MQTT Server is running\n');
});

// Conversation prompt endpoint
app.get('/prompt', async (req, res, next) => {
  try {
    const { beacon_id } = req.query;

    if (!beacon_id) {
      return res.status(400).json({ error: 'beacon_id is required' });
    }

    // Get nearby users and clean up old data
    const nearbyUsers = await getNearbyUsers(beacon_id);

    if (nearbyUsers.length < 1) {
      return res.status(200).json({ message: 'Not enough users nearby' });
    }

    // Fetch user profiles from Firestore
    const userProfiles = await Promise.all(
      nearbyUsers.map(async (userId) => {
        const userDoc = await firestore.collection('users').doc(userId).get();
        return userDoc.data();
      })
    );

    // Generate conversation starter
    const conversationStarter = await generateConversationStarter(userProfiles);
    
    if (!conversationStarter) {
      return res.status(500).json({ error: 'Failed to generate conversation starter' });
    }

    // Create prompt data
    const promptData = {
      timestamp: Date.now(),
      beacon_id,
      users: nearbyUsers,
      prompt: conversationStarter
    };

    // Send via MQTT
    mqttClient.publish('sebschlo/feeds/conversation-starters', JSON.stringify(promptData));

    // Store in Firebase
    await promptsRef.push().set(promptData);

    // Return the prompt
    return res.status(200).json(promptData);

  } catch (error) {
    next(error);
  }
});

// Register error handler
app.use(errorHandler);

// Publish beacon updates to MQTT (original functionality)
beaconsRef.on('value', (snapshot) => {
  const data = snapshot.val();
  mqttClient.publish('sebschlo/feeds/beacon-users', JSON.stringify(data), (err) => {
    if (err) {
      console.error('Failed to publish message:', err);
    } else {
      console.log('Message published to topic beacon_users');
    }
  });
});

// Handle MQTT connection events
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});
