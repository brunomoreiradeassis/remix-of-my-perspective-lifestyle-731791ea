// ---------------------------------------------------------------------------
// Inteligência/action-detector.ts
// Detecta se a mensagem do usuário é uma solicitação de ação (precisa de plano)
// ---------------------------------------------------------------------------

export function isActionRequest(message: string): boolean {
  const lower = message.toLowerCase().trim();
  
  // Mensagens muito curtas (< 15 chars) provavelmente sao conversa casual
  const shortActionWords = ["crie", "faca", "corrija", "ajuste", "delete", "remova", "adicione", "mude"];
  if (lower.length < 15 && !shortActionWords.some(w => lower.includes(w))) {
    return false;
  }
  
  // Saudacoes e conversa casual - NUNCA são ação
  const greetingPattern = /^(oi|ola|hey|hi|hello|e ai|fala|salve|bom dia|boa tarde|boa noite|tudo bem|como vai|obrigado|valeu|beleza|blz|ok|entendi|certo|legal|bacana|show|perfeito|massa)\b/i;
  if (greetingPattern.test(lower)) return false;

  // Perguntas exploratórias - NUNCA são ação
  const questionPattern = /^(o que e|o que sao|me explica|como funciona|qual a diferenca|por que|quando usar|posso usar|o que|como|qual|quais|por que|pra que)\b/i;
  if (questionPattern.test(lower) && lower.endsWith("?")) return false;

  // Perguntas puras sem verbos de ação
  if (lower.endsWith("?") && !shortActionWords.some(w => lower.includes(w))) return false;
  
  // Verbos de ação que indicam necessidade de plano
  const actionPatterns = [
    /\b(crie|criar|cria|construa|construir|faca|fazer|implemente|implementar|implementa)\b/i,
    /\b(modifique|modificar|modifica|altere|alterar|altera|ajuste|ajustar|ajusta)\b/i,
    /\b(corrija|corrigir|corrige|conserte|consertar|conserta|fix|fixe|fixar)\b/i,
    /\b(adicione|adicionar|adiciona|inclua|incluir|inclui|insira|inserir|insere)\b/i,
    /\b(remova|remover|remove|delete|deletar|deleta|exclua|excluir|exclui)\b/i,
    /\b(refatore|refatorar|refatora|reestruture|reestruturar|melhore|melhorar)\b/i,
    /\b(atualize|atualizar|atualiza|substitua|substituir|troque|trocar)\b/i,
    /\b(instale|instalar|instala|configure|configurar|configura)\b/i,
    /\b(gere|gerar|gera|build|monte|montar|monta)\b/i,
    /\b(estou com .*(erro|bug|problema)|nao .*(funciona|carrega|aparece|renderiza))\b/i,
  ];
  
  return actionPatterns.some(p => p.test(lower));
}
