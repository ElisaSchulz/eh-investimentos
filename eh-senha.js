/* EH Investimentos — regras de senha (as mesmas configuradas no Supabase:
 * Authentication → Sign In / Providers → Email → Password requirements).
 * Se a configuração do Supabase mudar, ajuste MINIMO e REGRAS aqui.
 *
 * Uso:
 *   EHSenha.anexar(inputSenha, inputConfirmacao, { escuro: false });  // lista ao vivo
 *   const falta = EHSenha.faltando(senha);   // [] quando a senha atende a tudo
 *   EHSenha.mensagemErro(error)              // traduz o erro do Supabase
 */
(function () {
  const MINIMO = 8;
  // Mesmos conjuntos de caracteres que o Supabase aceita em cada categoria
  const SIMBOLOS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
  const REGRAS = [
    { id: 'tamanho',   texto: `Pelo menos ${MINIMO} caracteres`, ok: s => s.length >= MINIMO },
    { id: 'minuscula', texto: 'Uma letra minúscula (a–z)',       ok: s => /[a-z]/.test(s) },
    { id: 'maiuscula', texto: 'Uma letra maiúscula (A–Z)',       ok: s => /[A-Z]/.test(s) },
    { id: 'numero',    texto: 'Um número (0–9)',                 ok: s => /[0-9]/.test(s) },
    { id: 'simbolo',   texto: 'Um símbolo (ex.: ! @ # $ % & *)', ok: s => [...s].some(c => SIMBOLOS.includes(c)) }
  ];

  const CSS = `
    .ehs-lista { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; max-width: 460px;
      font-family: 'Manrope', sans-serif; font-size: 12px; line-height: 1.45; text-align: left; }
    .ehs-lista li { display: flex; align-items: center; gap: 7px; color: #6C6D70; transition: color .15s; }
    .ehs-lista li::before { content: ''; width: 14px; height: 14px; flex-shrink: 0; border-radius: 50%;
      border: 1.5px solid currentColor; box-sizing: border-box; }
    .ehs-lista li.ok { color: #1F7A4D; }
    .ehs-lista li.ok::before { border-color: #1F7A4D; background: #1F7A4D
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.2 2.2 4.8-4.8' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/10px no-repeat; }
    .ehs-lista.escuro li { color: #9AA6C6; }
    .ehs-lista.escuro li.ok { color: #6cc596; }
    .ehs-lista.escuro li.ok::before { border-color: #6cc596; background-color: #6cc596; }
    .ehs-lista li.ehs-confere { grid-column: 1 / -1; }
    .ehs-lista li.ehs-confere.nao { color: #B3261E; }
    .ehs-lista.escuro li.ehs-confere.nao { color: #f08080; }
    @media (max-width: 420px) { .ehs-lista { grid-template-columns: 1fr; } }
  `;
  function estilo() {
    if (document.getElementById('ehs-css')) return;
    const st = document.createElement('style');
    st.id = 'ehs-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function faltando(senha) {
    return REGRAS.filter(r => !r.ok(senha || '')).map(r => r.texto.charAt(0).toLowerCase() + r.texto.slice(1));
  }

  // Lista embaixo do campo, atualizada a cada tecla. Com o campo de confirmação,
  // mostra também se as duas senhas coincidem (só depois que ele for preenchido).
  function anexar(input, confirmacao, opcoes = {}) {
    if (!input || input.dataset.ehsAnexado) return;
    input.dataset.ehsAnexado = '1';
    estilo();
    input.setAttribute('placeholder', `Mínimo ${MINIMO} caracteres`);
    input.setAttribute('autocomplete', 'new-password');

    const lista = document.createElement('ul');
    lista.className = 'ehs-lista' + (opcoes.escuro ? ' escuro' : '');
    lista.setAttribute('aria-live', 'polite');
    lista.innerHTML = REGRAS.map(r => `<li data-regra="${r.id}">${r.texto}</li>`).join('');
    (opcoes.depoisDe || input.closest('.password-wrap') || input).insertAdjacentElement('afterend', lista);

    let confere = null;
    if (confirmacao) {
      confere = document.createElement('ul');
      confere.className = lista.className;
      confere.innerHTML = '<li class="ehs-confere">As duas senhas coincidem</li>';
      confere.style.display = 'none';
      // Com a lista fora dos campos (ex.: campos lado a lado), a confirmação vem logo depois dela
      (opcoes.depoisDe ? lista : confirmacao).insertAdjacentElement('afterend', confere);
    }

    const atualizar = () => {
      const s = input.value;
      REGRAS.forEach(r => lista.querySelector(`[data-regra="${r.id}"]`).classList.toggle('ok', r.ok(s)));
      if (confere) {
        const c = confirmacao.value;
        confere.style.display = c ? '' : 'none';
        const li = confere.firstElementChild;
        const igual = c === s;
        li.classList.toggle('ok', igual);
        li.classList.toggle('nao', !igual);
        li.textContent = igual ? 'As duas senhas coincidem' : 'As senhas ainda não coincidem';
      }
    };
    input.addEventListener('input', atualizar);
    if (confirmacao) confirmacao.addEventListener('input', atualizar);
    atualizar();
  }

  // Mensagem para mostrar antes de enviar; null quando está tudo certo
  function validar(senha, confirmacao) {
    const falta = faltando(senha);
    if (falta.length) return 'A senha ainda precisa ter: ' + falta.join(', ') + '.';
    if (confirmacao !== undefined && senha !== confirmacao) return 'As senhas não coincidem.';
    return null;
  }

  // Erros de senha do Supabase em português
  function mensagemErro(error) {
    const msg = (error && error.message) || '';
    if (error && (error.code === 'weak_password' || /password should|weak password|at least one character/i.test(msg))) {
      return `Senha fraca. Use pelo menos ${MINIMO} caracteres, com letra minúscula, letra maiúscula, número e símbolo.`;
    }
    if (/same.*(old|previous)|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da senha atual.';
    return msg;
  }

  window.EHSenha = { MINIMO, REGRAS, anexar, faltando, validar, mensagemErro };
})();
