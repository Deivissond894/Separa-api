# 🔄 Sistema de Fallback Automático - Firebase

## 📊 Configuração Atual

### Banco de Dados Primário (1º)
- **Projeto:** `separacao-51e82`
- **Arquivo:** `separacao-51e82-firebase-adminsdk-fbsvc-9a587665ce.json`
- **Status:** ATIVO por padrão

### Banco de Dados Fallback (2º)
- **Projeto:** `separa-api`
- **Arquivo:** `separa-api-firebase-adminsdk-fbsvc-83883838b0.json`
- **Status:** Standby (ativa automaticamente se necessário)

---

## 🎯 Como Funciona

### 1. Detecção Automática de Falhas
O sistema monitora:
- ✅ Erros de quota excedida (`RESOURCE_EXHAUSTED`)
- ✅ Timeouts de conexão
- ✅ Falhas gerais do Firebase

### 2. Switch Automático
Quando detecta falha no banco primário:
```
PRIMARY (falha) → FALLBACK (ativa automaticamente)
```

### 3. Recuperação Automática
A cada 5 minutos, verifica se o primário voltou:
```
FALLBACK → PRIMARY (retorna automaticamente)
```

---

## 📝 Logs do Sistema

### Logs de Inicialização
```
[FIREBASE] ✅ Banco PRIMÁRIO ativo: separacao-51e82...
[FIREBASE] 🔄 Banco FALLBACK disponível: separa-api...
```

### Logs de Troca
```
[FIREBASE] ⚠️ Quota excedida no PRIMARY! Trocando para FALLBACK...
[FIREBASE] 🔄 Trocado para FALLBACK: separa-api...
```

### Logs de Recuperação
```
[FIREBASE] ✅ Retornado para PRIMARY: separacao-51e82...
```

### Logs de Health Check
```
[HEALTH] Banco ativo: PRIMARY
[HEALTH] Primary ainda indisponível: quota exceeded
```

### Logs de Operações
Todas as operações agora incluem qual banco está sendo usado:
```
[API][GET]/api/pedidos { count: 42, db: 'PRIMARY' }
[API][POST]/api/pedidos/:codigo { codigo: '12345', db: 'FALLBACK' }
```

---

## 🛡️ Redundância Garantida

### Cenários Cobertos

1. **Quota Diária Excedida**
   - Sistema troca para FALLBACK automaticamente
   - Retorna ao PRIMARY às 00:00 (reset da quota)

2. **Erro de Conexão**
   - Retry automático no FALLBACK
   - Logs detalhados do erro

3. **Manutenção do Firebase**
   - Continua operando no banco disponível
   - Sem downtime para usuários

4. **Falha Simultânea (raro)**
   - Retorna erro HTTP 500
   - Logs completos para debug

---

## 📊 Monitoramento

### Como Saber Qual Banco Está Ativo

1. **Logs do Servidor**
   - Verifique os logs no Fly.io
   - Comando: `flyctl logs`

2. **Health Check Automático**
   - Roda a cada 5 minutos
   - Aparece nos logs: `[HEALTH] Banco ativo: PRIMARY`

3. **Logs de Requisições**
   - Cada operação mostra: `db: 'PRIMARY'` ou `db: 'FALLBACK'`

---

## 🚀 Vantagens do Sistema

1. **Zero Downtime**
   - Troca automática sem interrupção

2. **Economia de Custos**
   - Usa plano gratuito de ambos bancos
   - Distribui a carga entre os dois

3. **Recuperação Automática**
   - Sempre tenta voltar ao banco primário
   - Sem intervenção manual

4. **Logs Detalhados**
   - Rastreamento completo de todas trocas
   - Facilita auditoria e debug

---

## ⚙️ Manutenção

### Arquivos Necessários no Servidor
```
separacao-51e82-firebase-adminsdk-fbsvc-9a587665ce.json  ← Primário
separa-api-firebase-adminsdk-fbsvc-83883838b0.json       ← Fallback
```

### Atualizar Credenciais
Se precisar trocar as credenciais:
1. Substitua o arquivo JSON correspondente
2. Faça deploy: `flyctl deploy`
3. Sistema reinicia e carrega novas credenciais

### Inverter Prioridade
Para tornar o `separa-api` primário:
1. Edite `server.js` linhas 31-32:
   ```javascript
   const PRIMARY_ACCOUNT = 'separa-api-firebase-adminsdk-fbsvc-83883838b0.json';
   const FALLBACK_ACCOUNT = 'separacao-51e82-firebase-adminsdk-fbsvc-9a587665ce.json';
   ```
2. Deploy: `flyctl deploy`

---

## 🔍 Teste do Sistema

### Testar Fallback Manualmente
1. Desative temporariamente o banco primário no Firebase Console
2. Faça uma requisição à API
3. Verifique logs: deve mostrar troca para FALLBACK

### Testar Recuperação
1. Reative o banco primário
2. Aguarde 5 minutos (próximo health check)
3. Verifique logs: deve mostrar retorno ao PRIMARY

---

## 📞 Suporte

Em caso de problemas:
1. Verifique logs: `flyctl logs`
2. Confirme que ambos arquivos JSON existem
3. Verifique console do Firebase de ambos projetos
4. Ambos projetos devem ter as mesmas coleções estruturadas

---

**Status:** ✅ Sistema implementado e ativo desde 29/01/2026
**Deploy:** https://separa-api.fly.dev/
