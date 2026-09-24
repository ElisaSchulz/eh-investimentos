// ─────────────────────────────────────────────────────────────
//  eh-diagnostico-supabase.js — EH Investimentos
//  Integração do Diagnóstico Financeiro com o Supabase da EH
//  (o mesmo projeto do Portal do Cliente): grava as respostas do
//  formulário na tabela `diagnosticos` e envia o relatório gerado
//  (HTML) para o bucket `relatorios-diagnostico`.
//
//  COMO CONFIGURAR:
//  1. Rode o script `eh-diagnostico-setup.sql` no SQL Editor do
//     painel do Supabase (pode rodar de novo sempre que quiser).
//  2. As constantes abaixo já apontam para o projeto da EH. Se um
//     dia o projeto mudar, troque pelos dados de
//     Settings > API (Project URL e anon public).
//
//  A chave "anon" é pública por definição — a segurança vem das
//  políticas de RLS criadas pelo setup: visitantes só conseguem
//  INSERIR respostas e ENVIAR arquivos, nunca ler os dados dos
//  outros. Você acessa tudo pelo painel do Supabase.
//
//  Enquanto o setup não for rodado, o diagnóstico funciona
//  normalmente — apenas não grava nada no Supabase.
// ─────────────────────────────────────────────────────────────

var EH_SUPABASE_URL = "https://migyqowqjfhvdcrtryms.supabase.co";
var EH_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZ3lxb3dxamZodmRjcnRyeW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODU1NjIsImV4cCI6MjA5MDc2MTU2Mn0.kydlPAkhBukqNDeLCS9Uhg-D5jZF9EL8Wi2oCDnY4eI";

(function () {
  "use strict";

  var TABELA = "diagnosticos";
  var BUCKET = "relatorios-diagnostico";

  var K_DATA = "eh_diagnostico_data";      // respostas finalizadas (já usado pelas páginas)
  var K_ID = "eh_diagnostico_id";          // id do envio atual
  var K_ARQUIVO = "eh_diagnostico_arquivo"; // caminho do relatório no Storage
  var K_SYNC = "eh_diagnostico_sync";      // "ok" quando as respostas já foram gravadas
  var K_UPLOAD = "eh_diagnostico_upload";  // "ok" quando o relatório já foi enviado

  // Último erro real devolvido pelo Supabase, exposto em ehSupabase.ultimoErro()
  // para a página de teste conseguir dizer o que está faltando configurar.
  var ultimoErro = null;

  function mensagemDeErro(err) {
    if (!err) return null;
    var partes = [err.message, err.details, err.hint, err.code].filter(Boolean);
    return partes.join(" · ") || "erro desconhecido";
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function configurado() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(EH_SUPABASE_URL).trim()) &&
      String(EH_SUPABASE_ANON_KEY).trim().length > 40;
  }

  // Repete uma promessa que resolve em "erro", com espera crescente.
  // Perder o relatório por uma oscilação de rede é o pior desfecho aqui.
  function comRetentativa(fn, tentativas, esperaMs) {
    return fn().then(function (r) {
      if (r !== "erro" || tentativas <= 1) return r;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(comRetentativa(fn, tentativas - 1, esperaMs * 2)); }, esperaMs);
      });
    });
  }

  var _client = null;
  function client() {
    if (!configurado() || !window.supabase || !window.supabase.createClient) return null;
    if (!_client) _client = window.supabase.createClient(EH_SUPABASE_URL, EH_SUPABASE_ANON_KEY);
    return _client;
  }

  function uuid4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = "";
    for (var j = 0; j < 16; j++) h += ("0" + b[j].toString(16)).slice(-2);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function slugify(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cliente";
  }

  // Chamada ao finalizar o formulário: prepara um novo envio
  // (novo id + nome do arquivo do relatório) e zera as flags de sincronização.
  function ehNovoEnvio(nome) {
    var id = uuid4();
    var arquivo = new Date().toISOString().slice(0, 10) + "_" + slugify(nome) + "_" + id.slice(0, 8) + ".html";
    lsSet(K_ID, id);
    lsSet(K_ARQUIVO, arquivo);
    lsDel(K_SYNC);
    lsDel(K_UPLOAD);
    return { id: id, arquivo: arquivo };
  }

  // Só números finitos vão para as colunas numéricas da tabela.
  function numero(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // Monta as colunas de resumo a partir do relatório calculado, para que a
  // tabela do Supabase seja legível sem abrir o JSON de respostas.
  function resumoDoRelatorio(stored) {
    if (!window.EHDiag || !window.EHDiag.computeReport) return {};
    var R = window.EHDiag.computeReport(stored.data, stored.geradoEm);
    var A = R.aposentadoria || {};
    return {
      score: R.scoreGeral,
      nivel: R.nivel.nome,
      arquetipo: R.arquetipo.nome,
      idade_aposentadoria: numero(A.idadeAposentadoria),
      estrategia: A.estrategiaLabel || null,
      renda_desejada: numero(stored.data.gastoMensalAposentadoria),
      patrimonio_necessario: numero(R.valores && R.valores.patrimonioNecessario),
      aporte_necessario: numero(R.valores && R.valores.aporteNecessario),
      aporte_atual: numero(R.valores && R.valores.aporteAtual),
      resumo: {
        geradoEm: stored.geradoEm || null,
        idade: R.data.idade,
        rendaTotal: R.kpis.rendaTotalDisplay,
        patrimonioTotal: R.kpis.patrimonioTotalDisplay,
        patrimonioNecessario: R.kpis.patrimonioNecessarioDisplay,
        aporteNecessario: R.kpis.aporteNecessarioDisplay,
        aporteAtual: R.kpis.aporteAtualDisplay,
        rendaSustentavel: R.kpis.rendaSustentavelDisplay,
        veredito: A.veredito ? A.veredito.tipo : null,
        dimensoes: R.dimRows.map(function (d) { return { nome: d.nome, score: d.score }; })
      }
    };
  }

  // Grava as respostas do formulário na tabela `diagnosticos`.
  // Idempotente: reenviar com o mesmo id não duplica (conflito = já enviado).
  // Retorna: "ok" | "ja-enviado" | "nao-configurado" | "sem-dados" | "erro"
  function enviarDiagnosticoUmaVez() {
    var sb = client();
    if (!sb) return Promise.resolve("nao-configurado");
    if (lsGet(K_SYNC) === "ok") return Promise.resolve("ja-enviado");

    var stored = null;
    try { stored = JSON.parse(lsGet(K_DATA) || "null"); } catch (e) {}
    if (!stored || !stored.data) return Promise.resolve("sem-dados");

    var id = lsGet(K_ID);
    var arquivo = lsGet(K_ARQUIVO);
    if (!id) {
      var novo = ehNovoEnvio(stored.data.nome);
      id = novo.id;
      arquivo = novo.arquivo;
    }

    // O resumo é um extra: se o cálculo falhar, as respostas ainda vão.
    var resumo = {};
    try { resumo = resumoDoRelatorio(stored); } catch (e) { ultimoErro = String(e && e.message || e); }

    var linha = Object.assign({
      id: id,
      nome: stored.data.nome || null,
      email: stored.data.email || null,
      respostas: stored.data,
      relatorio_arquivo: arquivo
    }, resumo);

    return sb.from(TABELA).insert(linha).then(function (res) {
      if (!res.error || res.error.code === "23505") {
        lsSet(K_SYNC, "ok");
        return "ok";
      }
      ultimoErro = mensagemDeErro(res.error);
      return "erro";
    }, function (e) { ultimoErro = String(e && e.message || e); return "erro"; });
  }

  function ehEnviarDiagnostico() {
    return comRetentativa(enviarDiagnosticoUmaVez, 3, 1500);
  }

  // Envia um retrato estático da página do relatório (HTML) para o
  // bucket `relatorios-diagnostico` do Storage. Deve ser chamada na página do
  // relatório, depois de renderizado.
  // Retorna: "ok" | "ja-enviado" | "nao-configurado" | "sem-dados" | "erro"
  function enviarRelatorioUmaVez() {
    var sb = client();
    if (!sb) return Promise.resolve("nao-configurado");
    if (lsGet(K_UPLOAD) === "ok") return Promise.resolve("ja-enviado");

    var arquivo = lsGet(K_ARQUIVO);
    if (!arquivo) return Promise.resolve("sem-dados");

    // O arquivo guardado é o relatório já renderizado, sem scripts nem os
    // controles da tela — abre sozinho no navegador, direto do Storage.
    var clone = document.documentElement.cloneNode(true);
    var descartaveis = clone.querySelectorAll("script, .no-print");
    for (var i = 0; i < descartaveis.length; i++) descartaveis[i].parentNode.removeChild(descartaveis[i]);
    var html = "<!DOCTYPE html>\n" + clone.outerHTML;

    return sb.storage.from(BUCKET)
      .upload(arquivo, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: false })
      .then(function (res) {
        var jaExiste = res.error && (String(res.error.statusCode) === "409" || /already exists|duplicate/i.test(res.error.message || ""));
        if (!res.error || jaExiste) {
          lsSet(K_UPLOAD, "ok");
          return "ok";
        }
        ultimoErro = mensagemDeErro(res.error);
        return "erro";
      }, function (e) { ultimoErro = String(e && e.message || e); return "erro"; });
  }

  function ehEnviarRelatorio() {
    return comRetentativa(enviarRelatorioUmaVez, 3, 1500);
  }

  // Verificação de saúde da integração, que pode ser chamada pelo console:
  // ehSupabase.verificar().then(console.log)
  // Não grava nada: só confere se a tabela e o bucket respondem.
  // Sob RLS a chave anon não lê linha nenhuma, então uma consulta que volta
  // vazia (sem erro) já prova que a tabela existe e está acessível.
  function ehVerificar() {
    var resultado = {
      configurado: configurado(),
      url: EH_SUPABASE_URL,
      biblioteca: !!(window.supabase && window.supabase.createClient),
      tabela: null, colunas: null, bucket: null
    };
    var sb = client();
    if (!sb) return Promise.resolve(resultado);

    var checaTabela = sb.from(TABELA).select("id").limit(1).then(function (res) {
      if (!res.error) { resultado.tabela = { ok: true }; return; }
      resultado.tabela = { ok: false, erro: mensagemDeErro(res.error), inexistente: res.error.code === "PGRST205" || /does not exist|não existe/i.test(res.error.message || "") };
    }, function (e) { resultado.tabela = { ok: false, erro: String(e && e.message || e), rede: true }; });

    // Consulta as colunas novas: se alguma faltar, o setup.sql é antigo.
    var checaColunas = sb.from(TABELA).select("estrategia,patrimonio_necessario,aporte_necessario,aporte_atual,idade_aposentadoria,renda_desejada,resumo").limit(1)
      .then(function (res) {
        if (!res.error) { resultado.colunas = { ok: true }; return; }
        resultado.colunas = { ok: false, erro: mensagemDeErro(res.error) };
      }, function (e) { resultado.colunas = { ok: false, erro: String(e && e.message || e) }; });

    // Uma listagem no bucket devolve erro claro quando ele não existe; com o
    // bucket criado, a política de anon (só insert) devolve lista vazia.
    var checaBucket = sb.storage.from(BUCKET).list("", { limit: 1 }).then(function (res) {
      if (!res.error) { resultado.bucket = { ok: true }; return; }
      var msg = mensagemDeErro(res.error);
      resultado.bucket = { ok: false, erro: msg, inexistente: /not found|bucket/i.test(msg || "") };
    }, function (e) { resultado.bucket = { ok: false, erro: String(e && e.message || e), rede: true } });

    return Promise.all([checaTabela, checaColunas, checaBucket]).then(function () { return resultado; });
  }

  // Envio de ponta a ponta com dados fictícios, para provar que gravação e
  // upload funcionam de verdade. A linha e o arquivo ficam marcados como
  // teste, para você apagar depois pelo painel.
  function ehEnviarTeste() {
    var sb = client();
    if (!sb) return Promise.resolve({ ok: false, erro: "Supabase não configurado neste arquivo." });

    var id = uuid4();
    var arquivo = "_teste/" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "_teste.html";
    var linha = {
      id: id,
      nome: "TESTE — pode apagar",
      email: "teste@ehinvestimentos.com.br",
      respostas: { teste: true, origem: "ehSupabase.enviarTeste()", quando: new Date().toISOString() },
      relatorio_arquivo: arquivo
    };

    return sb.from(TABELA).insert(linha).then(function (res) {
      if (res.error) return { ok: false, etapa: "tabela", erro: mensagemDeErro(res.error) };
      var html = "<!DOCTYPE html><meta charset=utf-8><title>Teste EH</title><p>Arquivo de teste enviado em " + new Date().toLocaleString("pt-BR") + ". Pode apagar.";
      return sb.storage.from(BUCKET)
        .upload(arquivo, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: false })
        .then(function (up) {
          if (up.error) return { ok: false, etapa: "storage", erro: mensagemDeErro(up.error), id: id };
          return { ok: true, id: id, arquivo: arquivo };
        });
    }, function (e) { return { ok: false, etapa: "tabela", erro: String(e && e.message || e) }; });
  }

  // Estado do envio deste navegador, útil para depurar um caso específico.
  function ehStatus() {
    return {
      configurado: configurado(),
      id: lsGet(K_ID),
      arquivo: lsGet(K_ARQUIVO),
      respostasEnviadas: lsGet(K_SYNC) === "ok",
      relatorioEnviado: lsGet(K_UPLOAD) === "ok",
      temDados: !!lsGet(K_DATA)
    };
  }

  window.ehSupabase = {
    configurado: configurado,
    novoEnvio: ehNovoEnvio,
    enviarDiagnostico: ehEnviarDiagnostico,
    enviarRelatorio: ehEnviarRelatorio,
    verificar: ehVerificar,
    enviarTeste: ehEnviarTeste,
    status: ehStatus,
    ultimoErro: function () { return ultimoErro; }
  };
})();
