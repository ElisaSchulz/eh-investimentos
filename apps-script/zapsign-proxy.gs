/**
 * Proxy ZapSign — Google Apps Script
 *
 * O onboarding (eh-onboarding.html) não chama o ZapSign direto (CORS) e não conhece
 * o token da API: manda o documento para este script, que acrescenta o token e
 * repassa ao ZapSign.
 *
 * Configuração (Editor do Apps Script → ⚙ Configurações do projeto → Propriedades do script):
 *   ZAPSIGN_TOKEN          token da API de produção (conta paga)            — obrigatório
 *   ZAPSIGN_SANDBOX_TOKEN  token da conta de testes (sandbox.app.zapsign)  — opcional
 *
 * Corpo esperado (POST, text/plain com JSON):
 *   { ambiente: 'producao' | 'teste', accessToken: '<sessão Supabase>', body: { ...documento ZapSign } }
 *
 * - producao: https://api.zapsign.com.br — exige um usuário logado no portal (accessToken
 *   validado no Supabase), para que só clientes do onboarding criem documentos.
 * - teste:    https://sandbox.api.zapsign.com.br — documentos de teste, sem validade jurídica.
 * - O parâmetro "sandbox" é sempre removido (a API de produção devolve erro 400 com ele
 *   a partir de 30/09/2026).
 */

const SUPABASE_URL = 'https://migyqowqjfhvdcrtryms.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZ3lxb3dxamZodmRjcnRyeW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODU1NjIsImV4cCI6MjA5MDc2MTU2Mn0.kydlPAkhBukqNDeLCS9Uhg-D5jZF9EL8Wi2oCDnY4eI';

const ZAPSIGN_ENDPOINTS = {
  producao: 'https://api.zapsign.com.br/api/v1/docs/',
  teste:    'https://sandbox.api.zapsign.com.br/api/v1/docs/'
};

function doGet(e) {
  return json({ status: 'ok', message: 'ZapSign proxy ativo' });
}

function doPost(e) {
  try {
    if (!e || !e.postData) return json({ error: 'No post data received' });

    const payload  = JSON.parse(e.postData.contents);
    const ambiente = payload.ambiente === 'teste' ? 'teste' : 'producao';
    const body     = payload.body || {};
    delete body.sandbox;

    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty(ambiente === 'teste' ? 'ZAPSIGN_SANDBOX_TOKEN' : 'ZAPSIGN_TOKEN');
    if (!token) return json({ error: 'Token do ZapSign (' + ambiente + ') não configurado nas propriedades do script.' });

    if (ambiente === 'producao' && !usuarioLogado(payload.accessToken)) {
      return json({ error: 'Sessão inválida ou expirada. Entre novamente no portal e tente de novo.' });
    }

    const response = UrlFetchApp.fetch(ZAPSIGN_ENDPOINTS[ambiente], {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const resultText = response.getContentText();
    Logger.log('Ambiente: ' + ambiente + ' · Status: ' + statusCode);
    if (statusCode >= 400) {
      Logger.log('Response: ' + resultText);
      return json({ error: 'ZapSign respondeu ' + statusCode + ': ' + resultText.slice(0, 300) });
    }
    return ContentService.createTextOutput(resultText).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error: ' + err.message);
    return json({ error: err.message });
  }
}

// Confere no Supabase se o accessToken é de uma sessão válida do portal
function usuarioLogado(accessToken) {
  if (!accessToken) return false;
  const resp = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/user', {
    method: 'get',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  return resp.getResponseCode() === 200;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
