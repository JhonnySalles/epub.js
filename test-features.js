const path = require("path");
const fs = require("fs");

// Load the compiled ePub library
const ePub = require("./lib/index.js").default;

async function runTest() {
  console.log("=== INICIANDO TESTE DAS NOVAS FUNCIONALIDADES ===");

  const epubFilePath = path.resolve(__dirname, "test/fixtures/alice.epub");
  console.log(`Carregando EPUB de teste em: ${epubFilePath}`);

  const buffer = fs.readFileSync(epubFilePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const book = ePub(arrayBuffer, { replacements: "none" });

  book.on("openFailed", (err) => {
    console.error("EVENTO OPEN_FAILED disparado:", err);
  });

  console.log("Aguardando book.opened...");
  try {
    await book.opened;
    console.log("✓ Livro aberto com sucesso!");
  } catch (err) {
    console.error("Erro no book.opened:", err);
  }

  // 1. Testar generateTrueLocations
  console.log("\n[1/3] Testando generateTrueLocations...");
  const pages = await book.generateTrueLocations({
    width: 800,
    height: 600,
    charsPerPage: 800
  });

  const totalPages = book.locations.totalPages;
  console.log(`✓ Total de páginas calculadas com fidelidade: ${totalPages}`);
  console.log(`✓ Exemplo página 1:`, JSON.stringify(pages[0], null, 2));

  // 2. Testar getChapterMarkers
  console.log("\n[2/3] Testando getChapterMarkers...");
  const markers = await book.getChapterMarkers();
  console.log(`✓ Total de marcadores de capítulo encontrados: ${markers.length}`);
  markers.slice(0, 5).forEach((m, idx) => {
    console.log(`  - Capítulo [${idx + 1}]: "${m.label}" -> Página: ${m.page}, Duração: ${m.pageCount} pág(s), Progresso: ${(m.percentage * 100).toFixed(1)}%`);
  });

  // 3. Testar getPage (extração headless de HTML)
  console.log("\n[3/3] Testando getPage (extração limpa de HTML/Texto da página)...");
  const page1 = await book.getPage(1);
  console.log(`✓ Página 1 extraída com sucesso:`);
  console.log(`  - Número da página: ${page1.pageNumber} / ${page1.totalPages}`);
  console.log(`  - Capítulo: ${page1.chapter ? page1.chapter.label : 'N/A'}`);
  console.log(`  - Tamanho do HTML: ${page1.html.length} caracteres`);
  console.log(`  - Texto (amostra): "${page1.text.substring(0, 100).replace(/\s+/g, ' ')}..."`);
  console.log(`  - CFI Início: ${page1.startCfi}`);

  const page5 = await book.getPage(5);
  console.log(`\n✓ Página 5 extraída com sucesso:`);
  console.log(`  - Número da página: ${page5.pageNumber} / ${page5.totalPages}`);
  console.log(`  - Capítulo: ${page5.chapter ? page5.chapter.label : 'N/A'}`);
  console.log(`  - Texto (amostra): "${page5.text.substring(0, 100).replace(/\s+/g, ' ')}..."`);

  console.log("\n=======================================================");
  console.log("TODAS AS 3 FUNCIONALIDADES FORAM TESTADAS COM SUCESSO!");
  console.log("=======================================================");
}

runTest().catch((err) => {
  console.error("Erro durante o teste:", err);
  process.exit(1);
});
