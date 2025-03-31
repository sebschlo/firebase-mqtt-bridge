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
const CLEANUP_THRESHOLD = 30000; // 30 seconds

// Generate a conversation starter using OpenAI
async function generateConversationStarter(userProfiles) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an installation in an interactive art experience consisting of a receipt printer attached to an Aruduino. People will have downloaded an app where they upload their profile describing themselves. As people approach the system, you will be provided the profile data from these users to find things in common to get them to break the ice and start chatting amongst themselves. Keep it casual and friendly, focusing on common interests or complementary experiences. Don't repeat or mention any details from their profile, but rather think about what things they might have in common. Be whimsical and creative with the prompt, and make it really short and punchy. Don't be afraid to go into weird or deep places, this is a social experiment and it should be interesting for the users. If only one person is present, give them a thought provoking question for them to ponder. Make sure you mention everyone's name so they know that the prompt is for them. Don't use any emojis."
        },
        {
          role: "user",
          content: `The following people approach: ${JSON.stringify(userProfiles)}. Create a brief and concise question that will get them talking about something they have in common. The question should not be too revealing or directly mention anything from their profiles, but be subtle and try to find interesting connections. Feel free to extrapolate from their profiles what they might like. Don't be too poetic, find a solid question. Ideally this should get them talking for a while.`
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

// Modified getNearbyUsers function to include more data
async function getNearbyUsers(beaconId, includeAll = false) {
  const snapshot = await beaconsRef.child(beaconId).child('users').once('value');
  const usersData = snapshot.val();
  if (!usersData) return [];

  const now = Date.now();
  const nearbyUsers = [];

  // Process users data
  for (const [userId, userData] of Object.entries(usersData)) {
    const timestamp = userData.timestamp * 1000; // Convert to milliseconds
    
    if (now - timestamp < CLEANUP_THRESHOLD) {
      if (includeAll || userData.signalStrength >= PROXIMITY_THRESHOLD) {
        nearbyUsers.push({
          id: userData.id,
          timestamp: timestamp,
          signalStrength: userData.signalStrength,
          age: Math.round((now - timestamp) / 1000) + ' seconds ago'
        });
      }
    } else {
      // Remove stale user data
      console.log(`Removing stale user data for user: ${userId}`);
      await beaconsRef.child(beaconId).child('users').child(userId).remove();
    }
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

    console.log(nearbyUsers);

    if (nearbyUsers.length < 1) {
      return res.status(200).json({ message: 'Not enough users nearby' });
    }

    // Fetch user profiles from Firestore
    const userProfiles = await Promise.all(
      nearbyUsers.map(async (user) => {
        const userDoc = await firestore.collection('users').doc(user.id).get();
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


app.get('/users', async (req, res, next) => {
  try {
    const { beacon_id } = req.query;

    if (!beacon_id) {
      return res.status(400).json({ error: 'beacon_id is required' });
    }

    // Get all users regardless of proximity
    const users = await getNearbyUsers(beacon_id, true);

    return res.status(200).json({
      total_users: users.length,
      proximity_threshold: PROXIMITY_THRESHOLD,
      cleanup_threshold: CLEANUP_THRESHOLD / 1000 + ' seconds',
      users: users
    });

  } catch (error) {
    next(error);
  }
});

// Register error handler
app.use(errorHandler);

// Publish beacon updates to MQTT (original functionality)
beaconsRef.on('value', (snapshot) => {
  const data = snapshot.val();
  const string = JSON.stringify(data);
  mqttClient.publish('sebschlo/feeds/beacon-users', string, (err) => {
    if (err) {
      console.error('Failed to publish message:', err);
    } else {
      console.log('Message published to topic beacon_users: ' + string);
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
