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

// Log básico de requisições para auditoria
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.originalUrl, { body: req.body });
  next();
});

// Função para obter timestamp considerando fuso de Brasília
function agoraBrasilMs() {
  const agora = new Date();
  const brasilia = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brasilia.getTime();
}

// ===== SISTEMA DE FALLBACK ENTRE BANCOS FIREBASE =====
const PRIMARY_ACCOUNT = 'separacao-51e82-firebase-adminsdk-fbsvc-9a587665ce.json';
const FALLBACK_ACCOUNT = 'separa-api-firebase-adminsdk-fbsvc-83883838b0.json';

let currentDBName = 'PRIMARY';
let primaryApp, fallbackApp, db;

try {
  // Inicializar banco primário
  const primaryPath = path.join(__dirname, PRIMARY_ACCOUNT);
  const primaryCreds = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  primaryApp = admin.initializeApp({
    credential: admin.credential.cert(primaryCreds)
  }, 'primary');
  
  // Inicializar banco fallback
  const fallbackPath = path.join(__dirname, FALLBACK_ACCOUNT);
  const fallbackCreds = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  fallbackApp = admin.initializeApp({
    credential: admin.credential.cert(fallbackCreds)
  }, 'fallback');
  
  // Começar com o banco primário
  db = primaryApp.firestore();
  console.log(`[FIREBASE] ✅ Banco PRIMÁRIO ativo: ${PRIMARY_ACCOUNT}`);
  console.log(`[FIREBASE] 🔄 Banco FALLBACK disponível: ${FALLBACK_ACCOUNT}`);
} catch (error) {
  console.error('[FIREBASE] ❌ Erro ao inicializar Firebase:', error);
  process.exit(1);
}

// Função para trocar de banco automaticamente
function switchToFallback() {
  if (currentDBName === 'PRIMARY') {
    db = fallbackApp.firestore();
    currentDBName = 'FALLBACK';
    console.log(`[FIREBASE] 🔄 Trocado para FALLBACK: ${FALLBACK_ACCOUNT}`);
  }
}

function switchToPrimary() {
  if (currentDBName === 'FALLBACK') {
    db = primaryApp.firestore();
    currentDBName = 'PRIMARY';
    console.log(`[FIREBASE] ✅ Retornado para PRIMARY: ${PRIMARY_ACCOUNT}`);
  }
}

// Middleware para detectar erros de quota e trocar automaticamente
async function executeWithFallback(operation, operationName = 'OPERATION') {
  try {
    const result = await operation(db);
    
    // Se estava em fallback e operação funcionou, tentar voltar ao primário
    if (currentDBName === 'FALLBACK') {
      try {
        await primaryApp.firestore().collection('pedidosAtivos').limit(1).get();
        switchToPrimary();
      } catch (e) {
        // Primário ainda indisponível, continuar no fallback
      }
    }
    
    return result;
  } catch (error) {
    const isQuotaError = error.message?.includes('quota') || 
                        error.message?.includes('RESOURCE_EXHAUSTED') ||
                        error.code === 8; // gRPC RESOURCE_EXHAUSTED
    
    if (isQuotaError && currentDBName === 'PRIMARY') {
      console.log(`[FIREBASE] ⚠️ Quota excedida no PRIMARY! Trocando para FALLBACK...`);
      switchToFallback();
      // Tentar novamente com o banco fallback
      return await operation(db);
    }
    
    throw error; // Re-lança erro se não for quota ou se já estava no fallback
  }
}

// Health check periódico (a cada 5 minutos)
setInterval(async () => {
  try {
    if (currentDBName === 'FALLBACK') {
      // Tentar acessar o primário
      await primaryApp.firestore().collection('pedidosAtivos').limit(1).get();
      switchToPrimary();
    }
  } catch (e) {
    console.log(`[HEALTH] Primary ainda indisponível: ${e.message}`);
  }
  console.log(`[HEALTH] Banco ativo: ${currentDBName}`);
}, 5 * 60 * 1000);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== TEMPO DO SERVIDOR (HORÁRIO DE BRASÍLIA) =====
app.get('/api/agora', (req, res) => {
  const agora = agoraBrasilMs();
  res.json({ agora, timezone: 'America/Sao_Paulo' });
});

// ===== PEDIDOS ATIVOS =====
app.get('/api/pedidos', async (req, res) => {
  try {
    const pedidos = await executeWithFallback(async (database) => {
      const snapshot = await database.collection('pedidosAtivos').get();
      const result = {};
      snapshot.forEach(doc => {
        result[doc.id] = doc.data();
      });
      console.log('[API][GET]/api/pedidos', { count: snapshot.size, db: currentDBName });
      return result;
    }, 'GET_PEDIDOS');
    
    res.json(pedidos);
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pedidos/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { status, iniciou, finalizou, andar2, fim } = req.body;
    const agora = agoraBrasilMs();
    console.log('[API][POST]/api/pedidos/:codigo', { codigo, body: req.body, db: currentDBName });
    
    await executeWithFallback(async (database) => {
      await database.collection('pedidosAtivos').doc(codigo).set(
        { status, iniciou, finalizou, andar2, fim, ultimaAtualizacao: agora },
        { merge: true }
      );
    }, 'UPDATE_PEDIDO');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos/:codigo', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para confirmar pedido e retornar tempoExpiracao
app.post('/api/pedidos/:codigo/confirmar', async (req, res) => {
  try {
    const { codigo } = req.params;
    const agora = agoraBrasilMs();
    const tempoExpiracao = agora + (10 * 60 * 1000); // 10 minutos do servidor
    
    await executeWithFallback(async (database) => {
      // Garante que oculto seja false ao confirmar (sincronização de status)
      await database.collection('pedidosAtivos').doc(codigo).update({
        tempoExpiracao: tempoExpiracao,
        oculto: false,  // Garantir que não está oculto ao confirmar
        ultimaAtualizacao: agora
      });
    }, 'CONFIRMAR_PEDIDO');
    
    console.log('[API][CONFIRM]/api/pedidos/:codigo/confirmar', { codigo, tempoExpiracao, agora, db: currentDBName });
    
    res.json({ 
      success: true, 
      tempoExpiracao: tempoExpiracao,
      agora: agora
    });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos/:codigo/confirmar', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== PEDIDOS CONFIRMADOS (NOVA COLEÇÃO) =====
// Endpoint para confirmar e registrar também em pedidosConfirmados
app.post('/api/pedidos-confirmados/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const payload = req.body || {};

    const agora = agoraBrasilMs();
    const tempoExpiracao = agora + (10 * 60 * 1000); // 10 minutos do servidor

    const updateData = {
      status: 'confirmado',
      tempoExpiracao,
      oculto: false,
      ultimaAtualizacao: agora,
      ...payload
    };

    await executeWithFallback(async (database) => {
      // Atualiza pedidosAtivos para manter a UI atual
      await database.collection('pedidosAtivos').doc(codigo).set(updateData, { merge: true });

      // Registra em nova coleção pedidosConfirmados
      await database.collection('pedidosConfirmados').doc(codigo).set({
        ...updateData,
        registradoEm: agora
      }, { merge: true });
    }, 'CONFIRMAR_PEDIDO_NOVO');

    console.log('[API][CONFIRM_NEW]/api/pedidos-confirmados/:codigo', { codigo, tempoExpiracao, db: currentDBName });

    res.json({ success: true, tempoExpiracao, agora });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos-confirmados/:codigo', err);
    res.status(500).json({ error: err.message });
  }
});

// Remoção apenas da coleção pedidosConfirmados (após 10 minutos)
app.delete('/api/pedidos-confirmados/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    await executeWithFallback(async (database) => {
      await database.collection('pedidosConfirmados').doc(codigo).delete();
    }, 'DELETE_CONFIRMADO');
    
    console.log('[API][DELETE]/api/pedidos-confirmados/:codigo', { codigo, db: currentDBName });
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos-confirmados/:codigo', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pedidos/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    await executeWithFallback(async (database) => {
      await database.collection('pedidosAtivos').doc(codigo).delete();
    }, 'DELETE_PEDIDO');
    
    console.log('[API][DELETE]/api/pedidos/:codigo', { codigo, db: currentDBName });
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos/:codigo', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== RELATÓRIO =====
app.get('/api/relatorio', async (req, res) => {
  try {
    const relatorio = await executeWithFallback(async (database) => {
      const snapshot = await database.collection('relatorioPedidos').orderBy('data', 'desc').get();
      const result = [];
      snapshot.forEach(doc => {
        result.push(doc.data());
      });
      return result;
    }, 'GET_RELATORIO');
    
    res.json(relatorio);
  } catch (err) {
    console.error('[API][ERROR]/api/relatorio', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relatorio', async (req, res) => {
  try {
    const { pedido, tipo, operador } = req.body;
    const data = agoraBrasilMs();
    
    await executeWithFallback(async (database) => {
      await database.collection('relatorioPedidos').add({
        pedido,
        tipo,
        operador,
        data
      });
    }, 'ADD_RELATORIO');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/relatorio', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== RELATÓRIO OTIMIZADO COM PAGINAÇÃO =====
app.get('/api/relatorio/buscar', async (req, res) => {
  try {
    const { filtroData, filtroPedido, pagina = 1, itensPorPagina = 10, ultimoDocId } = req.query;
    
    const resultado = await executeWithFallback(async (database) => {
      let query = database.collection('relatorioPedidos');
      
      // Filtro por pedido específico
      if (filtroPedido) {
        console.log('[API][RELATORIO_BUSCAR] Filtrando por pedido:', filtroPedido);
        query = query.where('pedido', '==', parseInt(filtroPedido));
        query = query.orderBy('data', 'desc');
      }
      // Filtro por data
      else if (filtroData) {
        const inicioDia = new Date(filtroData + "T00:00:00").getTime();
        const fimDia = new Date(filtroData + "T23:59:59").getTime();
        
        console.log('[API][RELATORIO_BUSCAR] Filtrando por data:', { filtroData, inicioDia, fimDia });
        
        query = query.where('data', '>=', inicioDia)
                     .where('data', '<=', fimDia)
                     .orderBy('data', 'desc');
      }
      // Sem filtro: ordenar por data apenas
      else {
        query = query.orderBy('data', 'desc');
      }
      
      // Paginação com cursor (se houver)
      if (ultimoDocId) {
        const ultimoDoc = await database.collection('relatorioPedidos').doc(ultimoDocId).get();
        if (ultimoDoc.exists) {
          query = query.startAfter(ultimoDoc);
        }
      }
      
      // Limitar resultados
      query = query.limit(parseInt(itensPorPagina));
      
      const snapshot = await query.get();
      
      const dados = [];
      let ultimoDocumento = null;
      
      snapshot.forEach(doc => {
        dados.push({ id: doc.id, ...doc.data() });
        ultimoDocumento = doc.id;
      });
      
      console.log('[API][RELATORIO_BUSCAR] Resultados:', {
        total: dados.length,
        pagina,
        db: currentDBName,
        leituras: snapshot.size
      });
      
      return {
        dados,
        ultimoDocId: ultimoDocumento,
        temMais: snapshot.size === parseInt(itensPorPagina),
        totalNaPagina: dados.length
      };
    }, 'BUSCAR_RELATORIO');
    
    res.json(resultado);
  } catch (err) {
    console.error('[API][ERROR]/api/relatorio/buscar', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== RANKING =====
app.get('/api/ranking', async (req, res) => {
  try {
    const ranking = await executeWithFallback(async (database) => {
      const doc = await database.collection('ranking').doc('mesAtual').get();
      if (doc.exists) {
        return doc.data();
      } else {
        return { n1: {}, n2: {} };
      }
    }, 'GET_RANKING');
    
    res.json(ranking);
  } catch (err) {
    console.error('[API][ERROR]/api/ranking', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ranking', async (req, res) => {
  try {
    const { n1, n2 } = req.body;
    
    await executeWithFallback(async (database) => {
      await database.collection('ranking').doc('mesAtual').set({ n1, n2 }, { merge: true });
    }, 'UPDATE_RANKING');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/ranking', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ranking', async (req, res) => {
  try {
    const senha = req.body.senha;
    if (senha !== '1617') return res.status(401).json({ error: 'Senha incorreta' });
    
    await executeWithFallback(async (database) => {
      await database.collection('ranking').doc('mesAtual').set({ n1: {}, n2: {} });
    }, 'CLEAR_RANKING');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/ranking', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HISTÓRICO RANKING =====
app.get('/api/ranking-historico', async (req, res) => {
  try {
    const historico = await executeWithFallback(async (database) => {
      const snapshot = await database.collection('historicoRanking').get();
      const result = [];
      snapshot.forEach(doc => {
        result.push(doc.data());
      });
      return result;
    }, 'GET_HISTORICO');
    
    res.json(historico);
  } catch (err) {
    console.error('[API][ERROR]/api/ranking-historico', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ranking-historico', async (req, res) => {
  try {
    const { mes, ranking } = req.body;
    
    await executeWithFallback(async (database) => {
      await database.collection('historicoRanking').add({ mes, ranking });
    }, 'ADD_HISTORICO');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/ranking-historico', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/relatorio', async (req, res) => {
  try {
    const senha = req.body.senha;
    if (senha !== '1617') return res.status(401).json({ error: 'Senha incorreta' });
    
    await executeWithFallback(async (database) => {
      const snapshot = await database.collection('relatorioPedidos').get();
      const batch = database.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }, 'CLEAR_RELATORIO');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/relatorio', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== LIMPAR PEDIDOS =====
app.delete('/api/pedidos-limpar', async (req, res) => {
  try {
    const senha = req.body.senha;
    console.log('[API][DELETE]/api/pedidos-limpar', { senhaOk: senha === '1617', db: currentDBName });
    if (senha !== '1617') return res.status(401).json({ error: 'Senha incorreta' });
    
    await executeWithFallback(async (database) => {
      const snapshot = await database.collection('pedidosAtivos').get();
      const batch = database.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }, 'CLEAR_PEDIDOS');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API][ERROR]/api/pedidos-limpar', err);
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
