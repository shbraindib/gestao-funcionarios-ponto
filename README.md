# Gestão de Funcionários e Ponto 2.0 Online

Esta pasta contém uma versão online inicial, baseada na versão 1.18, com:

- login por e-mail e senha;
- várias escolas no mesmo sistema, com dados isolados por unidade;
- perfis Administrador Geral, Administrador da Escola, Operador e Consulta;
- painel central para o usuário mestre criar escolas e usuários;
- modo **Visualizar como usuário**, sempre somente leitura;
- banco online com cópia local de contingência;
- importação dos backups JSON da versão local;
- funcionamento como PWA em computador, Android, iPhone e tablet;
- aba Sobre com crédito de desenvolvimento.

## O que falta para publicar

São necessárias contas gratuitas no **Supabase** e no **Cloudflare Pages**. O pacote não contém senhas nem chaves privadas. Siga `GUIA_DE_PUBLICACAO.md`.

## Estrutura

- `public/`: arquivos a publicar no Cloudflare Pages.
- `supabase/schema.sql`: tabelas e políticas de segurança.
- `supabase/functions/admin-users/`: função segura para criar usuários e redefinir senhas.
- `public/config.js`: URL e chave pública do Supabase, além do contato de suporte.

## Segurança

A chave `service_role` nunca deve ser colocada em `public/config.js`. Ela é usada apenas dentro da Edge Function do Supabase. O isolamento por escola é aplicado no banco com Row Level Security.
