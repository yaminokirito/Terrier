const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';
const DB_PATH = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let db = null;

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], medicines: [], requests: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getNextId(collection) {
  if (!collection.length) return 1;
  return Math.max(...collection.map((item) => item.id)) + 1;
}

function initDatabase() {
  db = loadDb();

  if (!db.users) db.users = [];
  if (!db.medicines) db.medicines = [];
  if (!db.requests) db.requests = [];

  const admin = db.users.find((user) => user.username === 'admin');
  if (!admin) {
    const passwordHash = bcrypt.hashSync('tcs123', 10);
    db.users.push({
      id: getNextId(db.users),
      username: 'admin',
      password: passwordHash,
      role: 'admin',
      createdAt: Date.now()
    });
  }

  if (!db.medicines.length) {
    const medicines = [
      { name: 'Fipronil', stock: 16 },
      { name: 'Imidacloprid', stock: 9 },
      { name: 'Deltamethrin', stock: 0 },
      { name: 'Cypermethrin', stock: 3 }
    ];
    medicines.forEach((item) => {
      db.medicines.push({ id: getNextId(db.medicines), name: item.name, stock: item.stock });
    });
  }

  saveDb();
}

function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '12h'
  });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    next();
  };
}

app.post('/api/auth/login', (req, res) => {
  const { role, username, password } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Role, username, and password are required.' });
  }

  const userRow = db.users.find((user) => user.username === username);
  if (!userRow) {
    if (role !== 'user') {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const hashed = bcrypt.hashSync(password, 10);
    const newUser = {
      id: getNextId(db.users),
      username,
      password: hashed,
      role: 'user',
      createdAt: Date.now()
    };
    db.users.push(newUser);
    saveDb();
    const user = { id: newUser.id, username: newUser.username, role: newUser.role };
    return res.json({ token: createToken(user), user });
  }

  if (userRow.role !== role) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (!bcrypt.compareSync(password, userRow.password)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const user = { id: userRow.id, username: userRow.username, role: userRow.role };
  res.json({ token: createToken(user), user });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const userRow = db.users.find((user) => user.id === req.user.id);
  if (!userRow) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ user: { id: userRow.id, username: userRow.username, role: userRow.role } });
});

app.get('/api/inventory', authenticate, (req, res) => {
  const medicines = db.medicines.map((item) => ({ id: item.id, name: item.name, stock: item.stock }));
  res.json({ medicines });
});

app.get('/api/requests', authenticate, (req, res) => {
  const results = db.requests
    .filter((request) => req.user.role === 'admin' || request.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((request) => {
      const user = db.users.find((u) => u.id === request.userId);
      const medicine = db.medicines.find((m) => m.id === request.medicineId);
      return {
        id: request.id,
        user: user ? user.username : 'Unknown',
        medicine: medicine ? medicine.name : 'Unknown',
        quantity: request.quantity,
        status: request.status,
        createdAt: request.createdAt
      };
    });
  res.json({ requests: results });
});

app.post('/api/requests', authenticate, (req, res) => {
  const { medicineId, quantity } = req.body;
  if (!medicineId || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'Medicine and positive quantity are required.' });
  }
  const medicine = db.medicines.find((item) => item.id === medicineId);
  if (!medicine) {
    return res.status(404).json({ error: 'Medicine not found.' });
  }
  db.requests.push({
    id: getNextId(db.requests),
    userId: req.user.id,
    medicineId,
    quantity,
    status: 'Pending',
    createdAt: Date.now()
  });
  saveDb();
  res.json({ message: 'Request submitted successfully.' });
});

app.post('/api/requests/:id/approve', authenticate, requireRole('admin'), (req, res) => {
  const requestId = Number(req.params.id);
  const request = db.requests.find((item) => item.id === requestId);
  if (!request) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (request.status !== 'Pending') {
    return res.status(400).json({ error: 'Request is already processed.' });
  }
  const medicine = db.medicines.find((item) => item.id === request.medicineId);
  if (!medicine) {
    request.status = 'Rejected';
    saveDb();
    return res.status(404).json({ error: 'Medicine no longer exists.' });
  }
  if (medicine.stock < request.quantity) {
    request.status = 'Rejected';
    saveDb();
    return res.status(400).json({ error: 'Not enough stock to approve the request.' });
  }
  medicine.stock -= request.quantity;
  request.status = 'Approved';
  saveDb();
  res.json({ message: 'Request approved.' });
});

app.post('/api/medicines', authenticate, requireRole('admin'), (req, res) => {
  const { medicineId, name, stock } = req.body;
  const quantity = Number(stock);
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Valid stock quantity is required.' });
  }
  if (medicineId) {
    const existing = db.medicines.find((item) => item.id === medicineId);
    if (!existing) {
      return res.status(404).json({ error: 'Medicine not found.' });
    }
    existing.stock += quantity;
  } else {
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Medicine name is required.' });
    }
    const normalized = name.trim();
    const existing = db.medicines.find((item) => item.name.toLowerCase() === normalized.toLowerCase());
    if (existing) {
      existing.stock += quantity;
    } else {
      db.medicines.push({ id: getNextId(db.medicines), name: normalized, stock: quantity });
    }
  }
  saveDb();
  res.json({ message: 'Medicine inventory updated.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDatabase();
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
