// ---------------------------------------------------------------------------
// skillsRegistry.ts
// Camada 3: Sistema de Skills e Capacidades
// Define o que o sistema pode fazer, templates, boas praticas e limitacoes.
// O prompt do sistema consulta este registro para adaptar suas respostas.
// ---------------------------------------------------------------------------

import type { ProjectMetadata } from "./projectScanner";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface Skill {
  id: string;
  name: string;
  description: string;
  // Condicao para habilitar a skill baseado no projeto
  isAvailable: (meta: ProjectMetadata) => boolean;
  // Instrucoes adicionais para o prompt quando a skill esta ativa
  promptInstructions: string;
}

// ---------------------------------------------------------------------------
// Registro de skills
// ---------------------------------------------------------------------------
const skills: Skill[] = [
  {
    id: "react-components",
    name: "Componentes React",
    description: "Criar e modificar componentes React funcionais",
    isAvailable: (meta) =>
      meta.patterns.hasTypeScript || meta.components.length > 0,
    promptInstructions: `COMPONENTES REACT:
- Use export function (nao export default em componentes de biblioteca)
- Props devem ser tipadas com interface
- Extraia logica complexa para custom hooks
- Use React.memo para componentes puros pesados
- Nomeie o arquivo igual ao componente: Button.tsx -> export function Button()`,
  },
  {
    id: "tailwind-styling",
    name: "Estilos Tailwind",
    description: "Estilizacao com classes utilitarias Tailwind CSS",
    isAvailable: (meta) => meta.patterns.hasTailwind,
    promptInstructions: `TAILWIND CSS:
- Use classes utilitarias em vez de CSS customizado
- Prefira gap-* sobre space-* para espacamento
- Use responsive prefixes: sm:, md:, lg:, xl:
- Componentes condicionais: cn() ou clsx() para classes dinamicas
- Design tokens: bg-background, text-foreground, border-border
- NUNCA misture margin/padding com gap no mesmo elemento`,
  },
  {
    id: "shadcn-ui",
    name: "shadcn/ui",
    description: "Componentes shadcn/ui disponíveis no projeto",
    isAvailable: (meta) => meta.patterns.uiLibrary === "shadcn",
    promptInstructions: `SHADCN/UI:
- Importe de @/components/ui/nome-componente
- Use as variantes existentes (default, destructive, outline, secondary, ghost, link)
- Compose componentes shadcn em vez de recriar do zero
- Use os tokens de cor do tema (--primary, --secondary, --muted, etc)`,
  },
  {
    id: "react-router",
    name: "React Router",
    description: "Roteamento com React Router DOM",
    isAvailable: (meta) => meta.patterns.routerType === "react-router",
    promptInstructions: `REACT ROUTER:
- Use <Link> e <NavLink> de react-router-dom (nao <a href>)
- useNavigate() para navegacao programatica
- useParams() e useSearchParams() para parametros
- Defina rotas em App.tsx ou routes.tsx centralizado
- Lazy loading: React.lazy() + <Suspense> para paginas`,
  },
  {
    id: "typescript-strict",
    name: "TypeScript Estrito",
    description: "TypeScript com tipagem forte",
    isAvailable: (meta) => meta.patterns.hasTypeScript,
    promptInstructions: `TYPESCRIPT:
- SEMPRE declare tipos/interfaces para props, state e retornos
- Evite 'any' - use 'unknown' se necessario
- Use type guards para narrowing
- Exporte tipos que outros arquivos possam precisar
- Nomeie interfaces com I prefix apenas se o projeto ja faz isso`,
  },
  {
    id: "state-context",
    name: "Context API",
    description: "Gerenciamento de estado com React Context",
    isAvailable: (meta) => meta.patterns.stateManagement === "context",
    promptInstructions: `CONTEXT API:
- Crie providers em src/contexts/
- Use custom hooks (useNomeContext) para consumir
- Separe contextos por dominio (auth, theme, data)
- Evite colocar todo estado em um unico contexto
- Use useCallback e useMemo para evitar re-renders desnecessarios`,
  },
  {
    id: "state-zustand",
    name: "Zustand",
    description: "Gerenciamento de estado com Zustand",
    isAvailable: (meta) => meta.patterns.stateManagement === "zustand",
    promptInstructions: `ZUSTAND:
- Crie stores em src/stores/
- Use slices para stores grandes
- Selectors para evitar re-renders: useStore(s => s.campo)
- Persist middleware para estado persistente
- Immer middleware para updates complexos`,
  },
  {
    id: "file-operations",
    name: "Operacoes de Arquivo",
    description: "Criar, modificar e excluir arquivos do projeto",
    isAvailable: () => true,
    promptInstructions: `OPERACOES DE ARQUIVO:
- Ao CRIAR um arquivo: gere o conteudo COMPLETO
- Ao MODIFICAR um arquivo: gere o conteudo COMPLETO (nao parcial)
- Ao EXCLUIR um arquivo: verifique se outros arquivos dependem dele
- SEMPRE atualize imports em arquivos que referenciam o arquivo modificado/excluido
- Mantenha a consistencia de nomenclatura do projeto existente`,
  },
  {
    id: "vite-project",
    name: "Projeto Vite",
    description: "Configuracao e otimizacao de projetos Vite",
    isAvailable: (meta) =>
      "vite" in meta.dependencies ||
      "vite" in meta.devDependencies ||
      meta.configs.some((c) => /vite\.config/i.test(c)),
    promptInstructions: `VITE:
- Entry point: src/main.tsx (nao index.tsx)
- Assets estaticos: pasta public/
- Variaves de ambiente: import.meta.env.VITE_*
- Hot Module Replacement esta habilitado por padrao
- Aliases: @/ mapeia para src/`,
  },
];

// ---------------------------------------------------------------------------
// Regras globais (sempre ativas)
// ---------------------------------------------------------------------------
const GLOBAL_RULES = `REGRAS GLOBAIS DE GERACAO DE CODIGO:
1. NOMEACAO DE ARQUIVOS:
   - CADA bloco DEVE comecar com comentario na 1a linha: // caminho/completo/arquivo.ext
   - Use EXATAMENTE os caminhos do plano. NUNCA invente nomes descritivos.
   - Mantenha a estrutura de pastas existente do projeto.

2. CODIGO COMPLETO:
   - Gere CADA arquivo por COMPLETO, sem abreviacoes ou "// ... resto do codigo"
   - Inclua TODOS os imports necessarios
   - Inclua TODAS as props e tipos

3. INTEGRIDADE DO PROJETO:
   - Se modificar um componente, verifique quem o importa
   - Se renomear ou excluir, atualize todas as referencias
   - Se adicionar dependencia, verifique se ja existe similar

4. PRESERVACAO:
   - Mantenha comentarios existentes quando relevantes
   - Preserve formatacao e estilo do projeto (tabs vs spaces, quotes, etc)
   - Nao altere arquivos que nao precisam ser alterados

5. QUALIDADE:
   - Acessibilidade: use semantic HTML, ARIA quando necessario
   - Performance: evite re-renders desnecessarios, use keys corretas
   - Seguranca: sanitize inputs, evite dangerouslySetInnerHTML`;

// ---------------------------------------------------------------------------
// Funcoes publicas
// ---------------------------------------------------------------------------

// Retorna as skills ativas para o projeto atual
export function getActiveSkills(meta: ProjectMetadata): Skill[] {
  return skills.filter((s) => s.isAvailable(meta));
}

// Gera o bloco de instrucoes do sistema baseado nas skills ativas
export function buildSkillsPrompt(meta: ProjectMetadata): string {
  const active = getActiveSkills(meta);
  const parts: string[] = [];

  parts.push(GLOBAL_RULES);
  parts.push("");
  parts.push("CAPACIDADES ATIVAS PARA ESTE PROJETO:");

  for (const skill of active) {
    parts.push("");
    parts.push(`--- ${skill.name} ---`);
    parts.push(skill.promptInstructions);
  }

  return parts.join("\n");
}

// Gera um resumo das limitacoes do sistema
export function getSystemLimitations(): string {
  return `LIMITACOES DO SISTEMA:
- Nao tem acesso a internet para baixar pacotes
- Nao pode executar comandos no terminal diretamente (usa servidor remoto)
- Gera apenas codigo em blocos markdown (nao pode criar binarios)
- Trabalha com um arquivo por vez na geracao (mas pode gerar multiplos blocos)
- Nao tem acesso a banco de dados ou APIs externas durante a geracao`;
}

// Gera instrucoes especificas para a fase de planejamento
export function buildPlanningPrompt(meta: ProjectMetadata): string {
  return `INSTRUCOES PARA PLANEJAMENTO:

DIAGNOSTICO DO PROJETO ATUAL:
${meta.summary}

ANALISE DE IMPACTO:
- Ao planejar modificacoes, considere o grafo de dependencias
- Arquivos com muitas dependencias devem ser modificados com cuidado
- Prefira modificacoes incrementais a reescritas completas
- Liste TODOS os arquivos afetados (incluindo atualizacoes de imports em cascata)

FORMATO DO PLANO:
### Diagnostico
(O que existe, o que precisa mudar, conflitos potenciais)

### Arquivos a criar
- caminho/completo/arquivo.ext (descricao breve)

### Arquivos a modificar
- caminho/completo/arquivo.ext (o que muda)

### Arquivos a excluir
- caminho/completo/arquivo.ext (por que excluir)

### Passos
1. Descricao clara do passo - envolvendo \`caminho/arquivo.ext\`
2. ...

### Validacao
(Checklist de consistencia: imports, tipos, rotas, estilos)`;
}

// Gera o prompt de sistema para modo conversacional (sem plano)
export function buildConversationalPrompt(meta: ProjectMetadata): string {
  return `Voce e um assistente de desenvolvimento inteligente e amigavel.
Responda de forma natural e conversacional. NAO gere planos de execucao a menos que o usuario EXPLICITAMENTE peca para fazer modificacoes no codigo, criar algo novo, ou corrigir erros.

REGRAS DE CONVERSA:
1. Se o usuario faz uma saudacao (oi, ola, tudo bem, etc), responda de forma amigavel e pergunte como pode ajudar.
2. Se o usuario faz uma pergunta sobre conceitos, tecnologias ou duvidas, responda diretamente a pergunta.
3. Se o usuario descreve um problema ou erro, analise e sugira solucoes. So gere um plano se ele pedir "ajuste", "corrija", "implemente", "crie", "faca", "modifique", "altere" ou expressoes similares de acao.
4. Se o usuario EXPLICITAMENTE pedir para fazer algo no codigo (criar, modificar, corrigir, implementar), AI gere o plano no formato especificado.
5. NUNCA gere plano para mensagens conversacionais simples.
6. Mantenha o contexto da conversa anterior para dar respostas coerentes.
7. NAO inclua blocos de codigo \`\`\`bash\`\`\` ou \`\`\`shell\`\`\` com comandos de terminal. O sistema tem seu proprio terminal integrado.
8. Quando gerar um plano, NAO inclua comandos de terminal como pnpm, npm, yarn, npx. Foque apenas nos arquivos a serem modificados.

CONTEXTO DO PROJETO:
${meta.summary || "Nenhum projeto aberto."}`;
}

// Detecta se a mensagem do usuario e uma solicitacao de acao (precisa de plano)
export function isActionRequest(message: string): boolean {
  const lower = message.toLowerCase().trim();
  
  // Mensagens muito curtas (< 15 chars) provavelmente sao conversa casual
  // a menos que contenham verbos de acao diretos
  const shortActionWords = ["crie", "faca", "corrija", "ajuste", "delete", "remova", "adicione", "mude"];
  if (lower.length < 15 && !shortActionWords.some(w => lower.includes(w))) {
    return false;
  }
  
  // Saudacoes e conversa casual
  const casualPatterns = [
    /^(oi|ola|hey|hi|hello|e ai|fala|salve|bom dia|boa tarde|boa noite|tudo bem|como vai|obrigado|valeu|beleza|blz|ok|entendi|certo|legal|bacana|show|perfeito|massa)\b/i,
    /^(o que e|o que sao|me explica|como funciona|qual a diferenca|por que|quando usar|posso usar)\b/i,
    /\?$/, // Perguntas puras geralmente nao precisam de plano
  ];
  
  // Se e claramente casual, nao e acao
  if (casualPatterns[0].test(lower)) return false;
  
  // Se e uma pergunta pura sem verbos de acao, nao e acao
  if (casualPatterns[2].test(lower) && casualPatterns[1].test(lower)) return false;
  
  // Verbos de acao que indicam necessidade de plano
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
    /\b(corrija .*(erro|bug|import)|resolve .*(erro|import|problema))\b/i,
  ];
  
  return actionPatterns.some(p => p.test(lower));
}

// Gera instrucoes especificas para a fase de execucao
export function buildExecutionPrompt(meta: ProjectMetadata): string {
  const skillsBlock = buildSkillsPrompt(meta);
  return `${skillsBlock}

INSTRUCOES DE EXECUCAO:
- Siga EXATAMENTE o plano aprovado
- Use os caminhos EXATOS listados no plano
- Gere codigo COMPLETO para cada arquivo
- Primeiro linha de cada bloco: // caminho/arquivo.ext
- Verifique que todos os imports estao corretos
- Mantenha consistencia com o estilo existente do projeto
- NAO inclua blocos bash/shell/terminal com comandos. O sistema tem terminal integrado.
- NAO sugira executar pnpm, npm, yarn, npx. Foque APENAS nos arquivos.
- Para imports de imagens/assets: use caminhos relativos corretos baseados na estrutura do projeto (ex: import img from '../assets/foto.jpg' ou import img from '@/assets/foto.jpg')
- Se um import de imagem falhar, verifique se o arquivo existe na pasta assets/ ou public/ e use o caminho correto
- SEMPRE resolva imports usando os alias configurados no projeto (@/ -> src/)`;
}
