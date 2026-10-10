# Minhas Anotações

Aplicativo pessoal React/TypeScript/Vite com Cloudflare Workers, D1 e Firebase Authentication.

## Desenvolvimento e validação

Requer Node.js 24. No Codespace, execute dentro de /workspaces/mynotes/app:

```sh
npm ci
npm run dev
npm run build
npm run lint
npm test
```

O binding DB aponta para mynotes-db. A aplicação usa o Firebase mynotes-auth-af57d, Google e e-mail/senha com e-mail confirmado. A configuração pública do cliente fica em src/firebase.ts; nunca adicionar chaves privadas, credenciais de serviço ou tokens ao repositório.

Para um ambiente local NOVO, inicialize as tabelas com:

```sh
npx wrangler d1 execute mynotes-db --local --file=schema.sql
```

Não há alteração de esquema nesta continuação. Não executar limpeza, recriação ou comandos remotos como parte dos testes. O banco existente do Codespace foi preservado.

## Funcionalidades

- Cadernos, seções e páginas: listar, criar, renomear e mover para lixeira.
- Lixeira com restauração. Excluir um caderno/seção oculta seus descendentes; restaurar conserva conteúdo e estrutura. Não há exclusão definitiva pela API.
- Editor de texto, listas e marcadores de tarefa, busca na seção atual e download do texto.
- Salvar por botão, Ctrl/Command+S, mudança de página/caderno/seção e saída da conta. Erros impedem a navegação e mantêm o rascunho. Fechar/recarregar com alterações pendentes pede confirmação do navegador.
- Controle de versão por updated_at: gravações concorrentes recebem 409 e o editor permite comparar com a versão salva ou baixar o rascunho.
- Quatro colunas, painéis translúcidos, temas claro/escuro. Em telas estreitas, rolagem horizontal conserva acesso a todas as colunas.
- Não há páginas demonstrativas. Formatos de conteúdo desconhecidos são somente leitura para evitar perda na conversão.

## Segurança e testes

Todas as rotas privadas validam tokens RS256 usando as chaves públicas oficiais Google: assinatura, emissor, audiência, expiração, iat, auth_time, sub e e-mail confirmado. O uid assinado define o proprietário; identificadores fornecidos pelo cliente nunca definem o usuário. SQL parametrizado e FKs compostas protegem o vínculo entre pais e filhos. Respostas privadas usam Cache-Control: no-store.

A validação JWT não consulta revogação administrativa em tempo real; tokens já emitidos podem valer até sua expiração. As tabelas legadas de senhas/sessões/tokens de e-mail não são usadas pela aplicação: Firebase gerencia credenciais.

Os testes usam Miniflare/D1 isolado em memória e duas identidades fictícias com tokens assinados por uma chave efêmera de teste. A chave é injetada apenas no handler de teste; o Worker publicado sempre usa Google JWKS. Cobrem acesso sem token, tokens inválidos, isolamento entre duas contas, ataques com IDs de outra conta, CRUD, restauração, concorrência, SQL parametrizado e limites de entrada. Não usam dados de produção nem criam contas Firebase reais.

A sessão real Firebase já autenticada foi usada para testar criação, edição e persistência após recarga no Codespace. A prova com DUAS contas reais no projeto Firebase continua pendente; os testes automatizados usam identidades de teste, não são prova desse fluxo externo.

Referências: https://firebase.google.com/docs/auth/admin/verify-id-tokens e https://developers.cloudflare.com/d1/worker-api/d1-database/.

## Publicação

A publicação em produção e o merge em main dependem de autorização do proprietário. Após aprovação, revisar domínio autorizado no Firebase, binding remoto e dados existentes, então usar npm run deploy. A implantação não deve aplicar schema.sql ou apagar dados automaticamente.
