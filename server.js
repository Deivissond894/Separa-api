import express from 'express';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Firebase Admin initialization
const serviceAccountPath = path.join(__dirname, 'separacao-51e82-firebase-adminsdk-fbsvc-ff690cda13.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== PEDIDOS ATIVOS =====
app.get('/api/pedidos', async (req, res) => {
  try {
    const snapshot = await db.collection('pedidosAtivos').get();
    const pedidos = {};
    snapshot.forEach(doc => {
      pedidos[doc.id] = doc.data();
    });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pedidos/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { status, iniciou, finalizou, andar2, fim } = req.body;
    
    await db.collection('pedidosAtivos').doc(codigo).set(
      { status, iniciou, finalizou, andar2, fim },
      { merge: true }
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pedidos/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    await db.collection('pedidosAtivos').doc(codigo).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== RELATÓRIO =====
app.get('/api/relatorio', async (req, res) => {
  try {
    const snapshot = await db.collection('relatorioPedidos').orderBy('data', 'desc').get();
    const relatorio = [];
    snapshot.forEach(doc => {
      relatorio.push(doc.data());
    });
    res.json(relatorio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relatorio', async (req, res) => {
  try {
    const { pedido, tipo, operador } = req.body;
    const data = Date.now();
    
    await db.collection('relatorioPedidos').add({
      pedido,
      tipo,
      operador,
      data
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/relatorio', async (req, res) => {
  try {
    const senha = req.body.senha;
    if (senha !== '1617') return res.status(401).json({ error: 'Senha incorreta' });
    
    const snapshot = await db.collection('relatorioPedidos').get();
    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== LIMPAR PEDIDOS =====
app.delete('/api/pedidos-limpar', async (req, res) => {
  try {
    const senha = req.body.senha;
    if (senha !== '1617') return res.status(401).json({ error: 'Senha incorreta' });
    
    const snapshot = await db.collection('pedidosAtivos').get();
    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SERVE HTML =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
