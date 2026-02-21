// ---------------------------------------------------------------------------
// Inteligência/skills.ts
// Registro de skills e capacidades do sistema com validações avançadas
// ---------------------------------------------------------------------------

import type { ProjectMetadata } from "../src/services/projectScanner";

export interface Skill {
  id: string;
  name: string;
  description: string;
  isAvailable: (meta: ProjectMetadata) => boolean;
  promptInstructions: string;
  validationRules?: string[]; // Regras específicas de validação para esta skill
  preservationRules?: string[]; // O que DEVE ser preservado ao usar esta skill
}

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
- Nomeie o arquivo igual ao componente: Button.tsx -> export function Button()
- Para componentes que recebem children, SEMPRE inclua React.ReactNode no tipo das props`,
    preservationRules: [
      "Ao modificar um componente existente, preserve TODAS as props originais (adicione novas como opcionais)",
      "Mantenha a assinatura da função original (export function vs export default)",
      "Nao remova funcionalidades existentes - apenas adicione ou modifique o necessario",
      "Preserve comentarios e documentacao existentes que explicam o componente"
    ],
    validationRules: [
      "Verifique se todas as props originais ainda estao sendo usadas corretamente",
      "Confirme que o componente ainda renderiza o conteudo original + novo",
      "Teste mentalmente se children ainda sao renderizados quando o componente os recebe",
      "Verifique se os tipos das props nao quebraram componentes pais que usam este componente"
    ]
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
- NUNCA misture margin/padding com gap no mesmo elemento
- Para hover/focus states, use hover:, focus:, active: antes das classes base
- Mantenha a hierarquia: base, hover, focus, active, responsive`,
    preservationRules: [
      "Ao modificar estilos existentes, preserve as classes originais a menos que seja explicitamente para substituir",
      "Mantenha a estrutura de cores do tema (nao invente cores novas se o tema ja tem)",
      "Preserve breakpoints existentes - use os mesmos que o projeto ja utiliza"
    ],
    validationRules: [
      "Verifique se as novas classes nao conflitam com as existentes",
      "Confirme se a responsividade foi mantida em todos os breakpoints",
      "Teste mentalmente se hover/focus states ainda funcionam",
      "Verifique se nao introduziu conflitos de especificidade CSS"
    ]
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
- Use os tokens de cor do tema (--primary, --secondary, --muted, etc)
- Para componentes compostos (Dialog, Popover, etc), mantenha a estrutura exata de filhos
- NUNCA modifique o CSS interno dos componentes shadcn - use className ou variantes
- Verifique se o componente existe antes de importar (alguns precisam ser instalados)`,
    preservationRules: [
      "Mantenha a estrutura de importacao original (@/components/ui/*)",
      "Preserve as variantes existentes ao modificar um componente que usa shadcn",
      "Nao remova subcomponentes necessarios (ex: DialogHeader, DialogContent de um Dialog)"
    ],
    validationRules: [
      "Verifique se todos os subcomponentes necessarios estao presentes",
      "Confirme se as props estao sendo passadas para o componente correto",
      "Teste mentalmente se o componente ainda funciona apos a modificacao",
      "Verifique se nao introduziu conflitos de acessibilidade (ARIA attributes)"
    ]
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
- Lazy loading: React.lazy() + <Suspense> para paginas
- Para rotas aninhadas, use <Outlet /> no componente pai
- SEMPRE preserve rotas existentes ao adicionar novas
- Coloque rotas mais especificas ANTES de rotas genericas (ex: /usuario/:id antes de /usuario)
- Use errorElement para tratamento de erros por rota`,
    preservationRules: [
      "NUNCA remova rotas existentes - apenas adicione novas",
      "Mantenha a estrutura de aninhamento de rotas original",
      "Preserve todos os loaders, actions e errorElements existentes",
      "Mantenha a ordem relativa das rotas (especificas antes de genericas)",
      "Nao remova o <Outlet /> de componentes pai"
    ],
    validationRules: [
      "Verifique se todas as rotas originais ainda sao acessiveis",
      "Confirme se parametros de rota (useParams) ainda funcionam",
      "Teste mentalmente se links para rotas existentes ainda funcionam",
      "Verifique se lazy loading nao quebrou por causa de import paths incorretos",
      "Confirme se rotas aninhadas ainda renderizam corretamente"
    ]
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
- Nomeie interfaces com I prefix apenas se o projeto ja faz isso
- Para objetos complexos, prefira 'type' ao inves de 'interface' se for uniao/interseccao
- Use 'as const' para constantes e enums
- Para generics, use nomes descritivos (TData, TProps) ao inves de T sozinho
- NUNCA quebre tipos existentes - mantenha compatibilidade retroativa`,
    preservationRules: [
      "Mantenha todos os tipos e interfaces existentes",
      "Ao modificar um tipo, faca as novas propriedades opcionais se possivel",
      "Nao remova exports de tipos que outros arquivos podem estar usando",
      "Preserve a estrutura de named exports vs default exports"
    ],
    validationRules: [
      "Verifique se todos os imports de tipos ainda resolvem corretamente",
      "Confirme que nenhum 'any' foi introduzido onde havia tipos especificos",
      "Teste mentalmente se as modificacoes de tipo nao quebraram componentes que usam esses tipos",
      "Verifique se nao introduziu circular dependencies de tipos",
      "Confirme se generics ainda funcionam com os tipos existentes"
    ]
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
- Use useCallback e useMemo para evitar re-renders desnecessarios
- SEMPRE forneca um valor default para o contexto
- Exporte o provider e o hook customizado separadamente
- Para contextos com muitas atualizacoes, considere separar em contextos de estado e de dispatch`,
    preservationRules: [
      "Mantenha todos os providers existentes na arvore de componentes",
      "Preserve a ordem dos providers (importante para dependencias entre contextos)",
      "Nao remova valores existentes do contexto - apenas adicione novos",
      "Mantenha os custom hooks existentes para consumir o contexto"
    ],
    validationRules: [
      "Verifique se todos os componentes que usam o contexto ainda tem acesso a ele",
      "Confirme que o valor default do contexto ainda e valido",
      "Teste mentalmente se as atualizacoes de estado ainda propagam corretamente",
      "Verifique se nao introduziu renderizacoes desnecessarias (useMemo/useCallback)",
      "Confirme se providers aninhados ainda funcionam na ordem correta"
    ]
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
- Immer middleware para updates complexos
- Para acoes assincronas, use dentro da store (set, get)
- Exporte hooks tipados para cada slice da store
- NUNCA recrie a store inteira - apenas adicione/modifique slices`,
    preservationRules: [
      "Mantenha todos os slices existentes da store",
      "Preserve o estado existente - adicione novos campos, nao remova os antigos",
      "Mantenha as acoes existentes funcionando",
      "Nao remova middlewares (persist, immer) se estavam sendo usados"
    ],
    validationRules: [
      "Verifique se todos os selectores ainda funcionam apos modificacoes",
      "Confirme que o estado persistido ainda e carregado corretamente",
      "Teste mentalmente se as acoes ainda modificam o estado como esperado",
      "Verifique se nao introduziu mutacoes diretas no estado (immer necessario)",
      "Confirme se os tipos da store ainda estao corretos"
    ]
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
- Mantenha a consistencia de nomenclatura do projeto existente
- Para arquivos existentes, preserve comentarios e estrutura original
- NUNCA modifique arquivos que nao estao listados no plano
- Ao modificar um arquivo, faca diff mental: o que mudou? o que foi preservado?`,
    preservationRules: [
      "NUNCA exclua um arquivo sem verificar todas as suas dependencias",
      "Ao renomear um arquivo, atualize TODOS os imports que o referenciam",
      "Preserve a estrutura de pastas existente - nao crie pastas desnecessarias",
      "Mantenha a convencao de nomenclatura do projeto (kebab-case, camelCase, etc)"
    ],
    validationRules: [
      "Verifique se todos os imports para arquivos modificados ainda resolvem",
      "Confirme que nenhum arquivo necessario foi excluido acidentalmente",
      "Teste mentalmente se a estrutura do projeto ainda e valida",
      "Verifique se nao criou duplicatas de arquivos existentes",
      "Confirme se os caminhos dos arquivos estao corretos (case sensitive)"
    ]
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
- Aliases: @/ mapeia para src/
- Para imports de assets: use caminhos relativos ou @/assets/
- NUNCA modifique o vite.config.ts a menos que seja explicitamente necessario
- Para adicionar plugins, verifique compatibilidade com a versao do Vite`,
    preservationRules: [
      "NUNCA modifique o vite.config.ts sem necessidade explicita",
      "Mantenha a estrutura de pastas public/ e src/ intacta",
      "Preserve os aliases existentes (@/*, etc)",
      "Nao altere a configuração de build sem necessidade"
    ],
    validationRules: [
      "Verifique se imports com @/ ainda resolvem corretamente",
      "Confirme que assets da pasta public/ ainda sao acessiveis",
      "Teste mentalmente se variaveis de ambiente ainda funcionam",
      "Verifique se HMR ainda funcionaria apos as modificacoes",
      "Confirme se a configuracao de build ainda produz o bundle esperado"
    ]
  },
  {
    id: "api-services",
    name: "API Services",
    description: "Integracao com APIs e servicos externos",
    isAvailable: (meta) => 
      meta.patterns.hasApiCalls || 
      meta.dependencies.axios !== undefined ||
      meta.dependencies["react-query"] !== undefined,
    promptInstructions: `API SERVICES:
- Centralize chamadas API em services/ ou lib/
- Use axios ou fetch com configuracao padrao (baseURL, headers)
- Trate erros adequadamente (try/catch, error boundaries)
- Para react-query: use useQuery e useMutation com keys consistentes
- NUNCA coloque logicas de API diretamente em componentes
- Use interceptors para auth tokens e tratamento de erros global
- Implemente retry logic para falhas temporarias
- Cache responses quando apropriado`,
    preservationRules: [
      "Mantenha a estrutura de services existente",
      "Preserve interceptors e configuracao global do axios/fetch",
      "Nao remova tratamento de erros existente",
      "Mantenha as queryKeys do react-query consistentes"
    ],
    validationRules: [
      "Verifique se todas as chamadas API ainda tem os headers corretos",
      "Confirme se o tratamento de erros ainda funciona",
      "Teste mentalmente se o cache nao esta retornando dados obsoletos",
      "Verifique se as mutations ainda invalidam as queries corretas",
      "Confirme se tokens de autenticacao ainda sao incluidos nas requisicoes"
    ]
  }
];

export const GLOBAL_RULES = `REGRAS GLOBAIS DE GERACAO DE CODIGO:
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
   - Seguranca: sanitize inputs, evite dangerouslySetInnerHTML

⚠️ VALIDACAO OBRIGATORIA POS-MODIFICACAO:
Para CADA arquivo modificado, execute mentalmente:
- [ ] Todas as funcionalidades existentes ainda funcionam?
- [ ] Nenhum import foi quebrado?
- [ ] Os tipos/types ainda estao corretos?
- [ ] A estrutura do arquivo foi preservada (apenas adicionado/modificado o necessario)?
- [ ] Componentes pais que usam este arquivo ainda funcionam?
- [ ] Rotas/Providers ainda estao acessiveis na mesma estrutura?
- [ ] Nenhum erro de sintaxe foi introduzido?

Se alguma dessas validacoes falhar, REVISE imediatamente antes de prosseguir.`;

export function getActiveSkills(meta: ProjectMetadata): Skill[] {
  return skills.filter((s) => s.isAvailable(meta));
}

export function buildSkillsPrompt(meta: ProjectMetadata): string {
  const active = getActiveSkills(meta);
  const parts: string[] = [];

  parts.push(GLOBAL_RULES);
  parts.push("");
  parts.push("CAPACIDADES ATIVAS PARA ESTE PROJETO:");

  for (const skill of active) {
    parts.push("");
    parts.push(`=== ${skill.name} ===`);
    parts.push(skill.promptInstructions);
    
    if (skill.preservationRules && skill.preservationRules.length > 0) {
      parts.push("");
      parts.push("🔒 REGRAS DE PRESERVACAO (OBRIGATORIO):");
      skill.preservationRules.forEach(rule => parts.push(`   • ${rule}`));
    }
    
    if (skill.validationRules && skill.validationRules.length > 0) {
      parts.push("");
      parts.push("✅ VALIDACOES POS-MODIFICACAO:");
      skill.validationRules.forEach(rule => parts.push(`   • ${rule}`));
    }
  }

  // Adiciona validacoes cross-skill no final
  parts.push("");
  parts.push("=== VALIDACOES GLOBAIS (TODAS AS MODIFICACOES) ===");
  parts.push("Apos aplicar TODAS as skills, verifique:");
  parts.push("   • O projeto como um todo ainda e compilavel?");
  parts.push("   • Nenhuma dependencia ciclica foi criada?");
  parts.push("   • A estrutura de rotas ainda esta consistente?");
  parts.push("   • Todos os providers ainda estao na ordem correta?");
  parts.push("   • Nenhum arquivo critico foi danificado?");

  return parts.join("\n");
}

// Funcao utilitaria para validar se uma modificacao e segura
export function validateModification(
  originalContent: string,
  modifiedContent: string,
  fileType: "component" | "route" | "store" | "service" | "config"
): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Validacoes basicas
  if (modifiedContent.includes("// ... resto do codigo") || 
      modifiedContent.includes("// ...") || 
      modifiedContent.includes("... resto")) {
    issues.push("Arquivo contém abreviacao '... resto do codigo' - gere o codigo completo");
  }
  
  // Validacoes especificas por tipo
  switch (fileType) {
    case "route":
      if (!modifiedContent.includes("<Route") && originalContent.includes("<Route")) {
        issues.push("Parece que todas as rotas foram removidas - isso provavelmente nao e intencional");
      }
      break;
    case "component":
      // Verifica se o componente ainda exporta algo
      if (!modifiedContent.includes("export") && originalContent.includes("export")) {
        issues.push("O componente nao esta mais sendo exportado");
      }
      break;
    case "store":
      if (!modifiedContent.includes("create(") && originalContent.includes("create(")) {
        issues.push("A store parece ter perdido sua criacao (create())");
      }
      break;
  }
  
  return {
    safe: issues.length === 0,
    issues
  };
}