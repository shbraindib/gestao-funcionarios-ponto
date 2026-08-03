# Guia de publicação — versão 2.0 Online

## 1. Criar o projeto no Supabase

1. Crie uma conta e um projeto gratuito no Supabase.
2. Abra **SQL Editor**, crie uma consulta e execute todo o arquivo `supabase/schema.sql`.
3. Em **Authentication > Users**, crie manualmente o seu primeiro usuário com e-mail e senha.
4. Volte ao SQL Editor e execute, trocando o e-mail:

```sql
insert into public.profiles(id,full_name,system_role,active)
select id,'Sergio H. R. Braindib','master',true
from auth.users
where email='SEU-EMAIL';
```

## 2. Publicar a função administrativa

Forma mais simples pelo painel:

1. Abra **Edge Functions** e crie a função `admin-users`.
2. Cole o conteúdo de `supabase/functions/admin-users/index.ts`.
3. Publique mantendo a verificação JWT ativada.

A função usa automaticamente `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente hospedado. A chave administrativa fica somente no servidor.

## 3. Configurar o aplicativo

No painel do Supabase, abra **Project Settings > API** e copie:

- Project URL;
- chave pública `anon` ou publishable.

Edite `public/config.js`:

```js
window.GFP_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  anonKey: 'SUA-CHAVE-PUBLICA',
  supportEmail: 'seu-email@exemplo.com',
  supportWhatsApp: '',
  developer: 'Sergio H. R. Braindib',
  appVersion: '2.0 Online'
};
```

Nunca coloque a chave `service_role` nesse arquivo.

## 4. Publicar gratuitamente no Cloudflare Pages

1. Crie uma conta no Cloudflare.
2. Abra **Workers & Pages > Create > Pages > Direct Upload**.
3. Dê um nome ao projeto.
4. Envie o conteúdo da pasta `public` — não a pasta externa inteira.
5. O Cloudflare fornecerá um endereço `pages.dev` com HTTPS.

## 5. Primeiro acesso

1. Acesse o endereço publicado.
2. Entre com o usuário mestre criado no Supabase.
3. Abra **Administração** e cadastre a primeira escola.
4. Selecione a escola na barra superior.
5. Abra **Backup**, importe o JSON da versão 1.18 e aguarde aparecer “Dados sincronizados”.
6. Cadastre os demais usuários no painel central.

## 6. Permissões

- **Administrador Geral:** todas as escolas, usuários e modo de visualização.
- **Administrador da escola:** cadastro, edição, configurações, folhas e relatórios da unidade.
- **Operador:** cadastros, ocorrências, férias, folhas e relatórios.
- **Consulta:** geração e impressão de folhas e relatórios, sem edição.

## 7. Visualizar como usuário

Na aba Administração, clique em **Visualizar** no vínculo do usuário. O sistema carrega a escola e as permissões daquela conta em modo somente leitura. Uma faixa amarela identifica o modo. Use **Sair do modo de visualização** para voltar ao usuário mestre.

## 8. Backup

Cada escola deve exportar periodicamente o arquivo JSON pelo menu Backup. A importação substitui os dados da unidade atualmente selecionada, sem afetar as demais escolas.

## 9. Recuperação de senha

Em **Authentication > URL Configuration**, adicione o endereço publicado do aplicativo em **Redirect URLs**. Assim, o botão “Esqueci minha senha” poderá retornar ao sistema e exibir a tela de definição da nova senha.

## 10. Edição central de usuários

No painel Administração, o usuário mestre pode alterar a permissão e ativar ou inativar cada conta, redefinir senha temporária, adicionar vínculos com outras escolas e entrar no modo de visualização.
