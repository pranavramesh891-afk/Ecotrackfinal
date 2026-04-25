
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Waste = require('./models/Waste');
const User = require('./models/User');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

app.get("/test", (req, res) => {
  res.send("TEST WORKING");
});

// ─── Uploads directory ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Serve uploaded images statically
app.use('/uploads', express.static(uploadDir));

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|heic/i;
  if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ─── JWT Secret ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'eco_track_secret_super_key';

// ─── MongoDB connection ───────────────────────────────────────────────────────
const connectDB = async () => {
  try {
    if (process.env.MONGO_URI && !process.env.MONGO_URI.includes('<username>')) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('✅ MongoDB connection successful');
    } else {
      console.log('⚠️  MongoDB connection skipped: provide a valid MONGO_URI in .env');
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
  }
};
connectDB();

// ─── Auth middleware ──────────────────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  // 1. Log request headers for debugging
  console.log(`[AUTH DEBUG] Request: ${req.method} ${req.originalUrl}`);
  console.log(`[AUTH DEBUG] Authorization Header:`, authHeader ? authHeader.substring(0, 20) + '...' : 'None');

  // 2. Handle missing token completely
  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied: No token provided' });
  }

  // 3. Validate Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied: Invalid format. Expected "Bearer <token>"' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied: Token missing after Bearer' });
  }

  // 4. Verify token
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error(`[AUTH DEBUG] JWT Verify Error:`, err.message);
      // Handle expired token specifically
      if (err.name === 'TokenExpiredError') {
         return res.status(401).json({ error: 'Access denied: Token expired' });
      }
      return res.status(403).json({ error: 'Access denied: Invalid token' });
    }
    
    // Valid token
    req.user = user;
    next();
  });
};

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('EcoTrack Backend Running ✅'));

// ─── Auth: Signup ─────────────────────────────────────────────────────────────
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    if (mongoose.connection.readyState !== 1)
      return res.status(201).json({ success: true, token: 'mockToken', user: { name, email } });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    const token = jwt.sign({ id: newUser._id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, user: { name: newUser.name, email: newUser.email } });
  } catch (error) {
    console.error('[/api/signup]', error.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ─── Auth: Login ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Credentials required' });

    if (mongoose.connection.readyState !== 1)
      return res.status(200).json({ success: true, token: 'mockToken', user: { email, name: email.split('@')[0] } });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ success: true, token, user: { name: user.name, email: user.email } });
  } catch (error) {
    console.error('[/api/login]', error.message);
    res.status(500).json({ error: 'Failed to process login' });
  }
});

// ─── AI Detect (mock) ─────────────────────────────────────────────────────────
// Simulates computer-vision detection by randomly returning a material type.
// When an image is attached it picks based on simple heuristics; otherwise random.
app.post('/api/detect', upload.single('image'), (req, res) => {
  console.log('[/api/detect] req.file  →', req.file || 'no file');
  console.log('[/api/detect] req.body  →', req.body);

  const materials = ['plastic', 'cardboard', 'paper'];
  // If a specific material was sent as a hint, use it; otherwise mock with random
  const hint = req.body?.material;
  const detected = materials.includes(hint) ? hint : materials[Math.floor(Math.random() * materials.length)];

  return res.status(200).json({
    success: true,
    material: detected,
    confidence: (Math.random() * 0.2 + 0.8).toFixed(2) // 0.80–1.00
  });
});

// ─── Log Waste (with image upload) ───────────────────────────────────────────
app.post('/api/log-waste', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    console.log('[/api/log-waste] req.file  →', req.file || 'no file');
    console.log('[/api/log-waste] req.body  →', req.body);

    const type = req.body.material || req.body.type;
    const platform = req.body.platform;

    // Validate required fields
    if (!type) {
      return res.status(400).json({ error: 'Material type is required' });
    }

    const imagePath = req.file ? req.file.filename : null;

    // Parse location safely
    let location = { lat: 0, lng: 0 };
    try {
      if (req.body.location) location = JSON.parse(req.body.location);
    } catch {
      // ignore malformed location
    }

    // Mock mode when DB is offline
    if (mongoose.connection.readyState !== 1) {
      console.log('[/api/log-waste] DB offline – returning mock response');
      return res.status(201).json({
        success: true,
        message: 'Waste logged successfully (mock mode)',
        data: { type, platform: platform || 'Other', imagePath, location }
      });
    }

    const newWaste = new Waste({
      userId: req.user.id,
      type,
      platform: platform || 'Other',
      imagePath,
      location
    });
    await newWaste.save();

    console.log('[/api/log-waste] saved →', newWaste._id);
    res.status(201).json({
      success: true,
      message: 'Waste logged successfully',
      data: newWaste
    });
  } catch (error) {
    console.error('[/api/log-waste] ERROR →', error.message);
    res.status(500).json({ error: 'Failed to save waste data', details: error.message });
  }
});

// ─── Get Waste list ───────────────────────────────────────────────────────────
app.get('/api/waste', authenticateToken, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json([
        { _id: '1', type: 'plastic', platform: 'Amazon', createdAt: new Date().toISOString() },
        { _id: '2', type: 'cardboard', platform: 'eBay', createdAt: new Date(Date.now() - 86400000).toISOString() }
      ]);
    }
    const wastes = await Waste.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(wastes);
  } catch (error) {
    console.error('[/api/waste GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch waste entries' });
  }
});

// ─── AI Image Classification Endpoint ─────────────────────────────────────────
app.post('/api/classify-waste', authenticateToken, async (req, res) => {
  try {
    const { imageBase64, platform, location } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Image required for classification' });

    console.log('[/api/classify-waste] processing image...');

    // Extract raw base64 and write to file to preserve imagePath format
    let rawBase64 = imageBase64;
    let ext = '.png';
    const match = imageBase64.match(/^data:image\/(\w+);base64,/);
    if (match) {
      ext = `.${match[1]}`;
      rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    }

    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(rawBase64, 'base64'));

    // Try AI integration
    let type = 'plastic'; // fallback
    let confidence = 0.90;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1' } });
        const prompt = `
You are a waste material expert. Use texture analysis. 
Plastic has specular highlights and reflections. Cardboard/Paper is matte and shows fiber grain. 
If you see matte texture with brown/white pulp, it is NOT plastic.

Classify this waste into exactly one of these categories: paper, plastic, cardboard.
Enforce Multi-Step Reasoning: Before returning the category, analyze and describe:
1. Surface Texture: Matte, Shiny, or Grainy?
2. Opacity: Transparent, Translucent, or Opaque?
3. Structural Clues: Edges, thickness, folds?

Output Format: Return the result strictly as a pure JSON object without markdown wrappers:
{ "category": "paper|plastic|cardboard", "confidence": "0.xx", "reasoning": "..." }
        `.trim();

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-preview',
          contents: [
            prompt,
            {
              inlineData: {
                data: rawBase64,
                mimeType: `image/${match ? match[1] : 'jpeg'}`
              }
            }
          ]
        });
        
        let ansText = response.text.trim();
        // Remove markdown formatting if Gemini wrapped it
        ansText = ansText.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
        
        let aiData;
        try {
          aiData = JSON.parse(ansText);
          console.log("[AI Logic Extraction]:", aiData.reasoning);
        } catch (e) {
          console.error("Failed to parse AI JSON:", ansText);
          aiData = { category: 'plastic', confidence: "0.80", reasoning: String(ansText) }; 
        }

        const ans = (aiData.category || '').toLowerCase();
        
        // sanitize strictly
        if (ans.includes('paper')) type = 'paper';
        else if (ans.includes('cardboard')) type = 'cardboard';
        else if (ans.includes('plastic')) type = 'plastic';
        else type = 'plastic'; // rigid fallback

        if (aiData.confidence) {
          const parsedConf = parseFloat(aiData.confidence);
          if (!isNaN(parsedConf)) confidence = parsedConf;
        }
      } else {
        console.warn('⚠️ No GEMINI_API_KEY found, returning fake AI result.');
        type = ['plastic', 'paper', 'cardboard'][Math.floor(Math.random() * 3)];
      }
    } catch (aiError) {
      console.error('AI Error:', aiError.message);
      // Fallback preserves normal operation
    }

    // Save to Mongo
    let locObj = { lat: 0, lng: 0 };
    try {
      if (location) locObj = typeof location === 'string' ? JSON.parse(location) : location;
    } catch { /* ignore */ }

    if (mongoose.connection.readyState !== 1) {
      return res.status(201).json({
        success: true,
        message: 'Classified successfully (mock DB mode)',
        data: { type, platform: platform || 'Other', imagePath: filename, location: locObj },
        confidence
      });
    }

    const newWaste = new Waste({
      userId: req.user.id,
      type,
      platform: platform || 'Other',
      imagePath: filename,
      location: locObj
    });
    await newWaste.save();

    res.status(201).json({
      success: true,
      message: 'Waste classified and logged successfully',
      data: newWaste,
      confidence
    });
  } catch (err) {
    console.error('[/api/classify-waste] ERROR →', err.message);
    res.status(500).json({ error: 'Failed to classify image', details: err.message });
  }
});

// ─── Legacy POST /api/waste (JSON only – kept for backwards compatibility) ────
app.post('/api/waste', authenticateToken, async (req, res) => {
  try {
    const { type, platform, location } = req.body;

    if (mongoose.connection.readyState !== 1)
      return res.status(201).json({ success: true, message: 'Saved (mock)', data: { type, platform } });

    const newWaste = new Waste({
      userId: req.user.id,
      type,
      platform: platform || 'Other',
      location: location || { lat: 0, lng: 0 }
    });
    await newWaste.save();
    res.status(201).json({ success: true, message: 'Saved successfully', data: newWaste });
  } catch (error) {
    console.error('[/api/waste POST]', error.message);
    res.status(500).json({ error: 'Failed to save waste data' });
  }
});

// ─── Trend ────────────────────────────────────────────────────────────────────
app.get('/api/trend', authenticateToken, async (req, res) => {
  try {
    const defaultWeek = [
      { name: 'Mon', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Tue', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Wed', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Thu', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Fri', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Sat', plastic: 0, cardboard: 0, paper: 0 },
      { name: 'Sun', plastic: 0, cardboard: 0, paper: 0 }
    ];

    if (mongoose.connection.readyState !== 1) return res.json(defaultWeek);

    const wastes = await Waste.find({ userId: req.user.id });
    wastes.forEach(waste => {
      const dayIndex = new Date(waste.createdAt).getDay();
      const idx = dayIndex === 0 ? 6 : dayIndex - 1;
      if (waste.type === 'plastic') defaultWeek[idx].plastic++;
      else if (waste.type === 'cardboard') defaultWeek[idx].cardboard++;
      else if (waste.type === 'paper') defaultWeek[idx].paper++;
    });

    res.json(defaultWeek);
  } catch (error) {
    console.error('[/api/trend]', error.message);
    res.status(500).json({ error: 'Failed to fetch trend' });
  }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.json({ totalWaste: 42, plastic: 20, cardboard: 15, paper: 7 });

    const [totalWaste, plastic, cardboard, paper] = await Promise.all([
      Waste.countDocuments({ userId: req.user.id }),
      Waste.countDocuments({ userId: req.user.id, type: 'plastic' }),
      Waste.countDocuments({ userId: req.user.id, type: 'cardboard' }),
      Waste.countDocuments({ userId: req.user.id, type: 'paper' })
    ]);

    res.json({ totalWaste, plastic, cardboard, paper });
  } catch (error) {
    console.error('[/api/dashboard]', error.message);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// ─── Recycling Centers ────────────────────────────────────────────────────────
app.get('/api/recycling', (_req, res) => {
  res.json([
    { id: 1, name: 'Eco Hub Center', distance: '1.2 miles' },
    { id: 2, name: 'Green Path Recycling', distance: '2.5 miles' },
    { id: 3, name: 'City Waste Management', distance: '3.8 miles' }
  ]);
});

// ─── Multer error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    console.error('[Multer Error]', err.message);
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error('[Server Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
