// 🧪 TESTE SUPER SIMPLES - COPIE E COLE NO CONSOLE DO NAVEGADOR (F12)

// ========== PASSO 1: Ativar Modo TV ==========
console.log("📺 PASSO 1: Ativando Modo TV...");
document.body.classList.add("modo-tv");
document.getElementById("btn-test-overlay").style.display = "block";
console.log("✅ Modo TV ativado! Verificando...");
console.log("Modo TV está ativo?", document.body.classList.contains("modo-tv"));

// ========== PASSO 2: Verificar função ==========
console.log("\n🔍 PASSO 2: Verificando função...");
console.log("Função existe?", typeof window.mostrarAlertaNaoEncontradoTV);
if (typeof window.mostrarAlertaNaoEncontradoTV !== "function") {
  console.error("❌ ERRO: Função não existe!");
}

// ========== PASSO 3: Chamar função ==========
console.log("\n🚀 PASSO 3: Chamando função de teste...");
console.log("Você deve ver o OVERLAY GIGANTE na tela agora!");
console.log("Se não aparecer em 1 segundo, há um problema grave.\n");

window.mostrarAlertaNaoEncontradoTV("TESTE-123", "PEÇA-ABC", Date.now(), Date.now() + 5*60*1000);

// ========== PASSO 4: Debug ==========
console.log("\n🔍 PASSO 4: Debug...");
const overlay = document.getElementById("overlay-nao-encontrado-tv");
console.log("Overlay existe?", overlay !== null);
console.log("Overlay display:", overlay?.style.display);
console.log("Overlay z-index:", overlay?.style.zIndex);
console.log("Overlay opacity:", overlay?.style.opacity);
console.log("Overlay no DOM?", document.body.contains(overlay));

if (overlay) {
  console.log("✅✅✅ OVERLAY CRIADO COM SUCESSO!");
} else {
  console.error("❌ ERRO: Overlay não foi criado!");
}
