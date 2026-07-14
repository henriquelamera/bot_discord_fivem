# Bot RBK

Bot de Discord para a facção RBK (GTA V FiveM).

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou superior instalado.

## Configuração

1. Instale as dependências:
   ```
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha:
   - `DISCORD_TOKEN`: token do bot (Discord Developer Portal → Bot).
   - `CLIENT_ID`: ID da aplicação (Developer Portal → General Information).
   - `GUILD_ID`: ID do servidor do Discord onde o bot vai rodar (clique com botão direito no servidor com o modo desenvolvedor ativado).
   - `MEMBROS_CHANNEL_ID`: ID do canal onde serão postados os avisos de entrada/saída de membros.
   - `VISITANTE_ROLE_ID`: ID do cargo "Visitante" que será dado automaticamente a quem entrar (se deixar em branco, o bot tenta achar um cargo chamado exatamente "Visitante").
   - `WELCOME_TEXT` (opcional): texto da mensagem de boas-vindas. Padrão: `Bem vindo(a) a <nome do servidor>!`.
   - `WELCOME_BANNER_URL` (opcional): URL de uma imagem para aparecer como banner no embed de boas-vindas.
3. No Discord Developer Portal → Bot, ative o intent privilegiado **SERVER MEMBERS INTENT** (obrigatório para detectar entradas/saídas). Sem isso os eventos não disparam.
4. Dê ao bot a permissão **Gerenciar Cargos** e posicione o cargo do bot **acima** do cargo "Visitante" na hierarquia do servidor (Configurações → Cargos), senão ele não conseguirá atribuir o cargo.
5. Registre os comandos de barra (`/`) no servidor:
   ```
   npm run deploy
   ```
6. Inicie o bot:
   ```
   npm start
   ```

## Comandos incluídos (exemplo)

- `/ponto entrar` | `/ponto sair` | `/ponto status` — sistema de ponto dos membros.
- `/advertencia aplicar` | `/advertencia consultar` — sistema de advertências.
- `/anuncio` — envia um anúncio formatado em um canal escolhido.

Os dados de ponto e advertências são salvos em `src/data/*.json` (arquivos ignorados pelo git).

## Entrada/saída de membros

Ao entrar (`guildMemberAdd`) ou sair (`guildMemberRemove`) do servidor, o bot posta automaticamente um embed no canal definido em `MEMBROS_CHANNEL_ID`:

- **Entrada**: usuário, data de criação da conta, total de membros no servidor.
- **Saída**: usuário, tempo que ficou no servidor, total de membros restantes.

O histórico de entrada é salvo em `src/data/membros.json` para calcular o tempo de permanência.

## Próximos passos sugeridos

- Sistema de recrutamento (formulário de aplicação via botões/modais).
- Painel de hierarquia/patentes.
- Sistema de tickets de suporte.
- Mensagem de boas-vindas por DM ao novo membro.
