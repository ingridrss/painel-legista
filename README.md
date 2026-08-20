# Painel Médico Legista com sincronização Supabase

## 1. Crie um projeto no Supabase

Entre em supabase.com e crie um projeto.

## 2. Crie a tabela

No Supabase:
SQL Editor > New query

Cole e execute o arquivo:
`supabase/setup.sql`

## 3. Pegue suas chaves

No Supabase:
Project Settings > API

Copie:
- Project URL
- anon / public key

Abra:
`assets/supabase-config.js`

Substitua:

```js
window.LEGISTA_SUPABASE_URL = "COLE_AQUI_SUA_PROJECT_URL";
window.LEGISTA_SUPABASE_ANON_KEY = "COLE_AQUI_SUA_ANON_PUBLIC_KEY";
```

## 4. Suba os arquivos no GitHub

Substitua seu `index.html`.

Substitua as semanas 01–05 pelos arquivos desta pasta `semanas/`.

Adicione:
- `assets/supabase-config.js`
- `assets/sync.js`
- `supabase/setup.sql` (opcional no site; pode manter só como referência)

## 5. Entre no painel

Abra o site.
Clique em `Entrar / sincronizar`.
Crie uma conta.

Use o mesmo login no celular e no computador.

## Como o progresso é salvo

O sistema continua usando o localStorage para funcionar rapidamente/offline.
Quando você está logado, as chaves do estudo são sincronizadas com o Supabase.

Na primeira sincronização:
- se o Supabase estiver vazio, o progresso já existente neste navegador é enviado;
- se já houver progresso na nuvem, ele é baixado;
- chaves locais que ainda não existirem na nuvem são preservadas.

Depois disso, novas alterações recebem horário e o valor mais recente é mantido.

## Segurança

A tabela usa Row Level Security (RLS).
Cada usuário autenticado só consegue ler e alterar a própria linha.
A `anon public key` pode ficar no front-end; a segurança depende das políticas RLS.
Nunca coloque `service_role` no GitHub.
