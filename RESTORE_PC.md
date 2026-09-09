# Restaurar o ambiente depois de formatar o PC

Checklist escrito em 2026-09-09, antes da formatação. Nada aqui contém senha/token.

## Antes de formatar (backup)
- Copiar a pasta inteira `c:\bot rbk` (pode pular `node_modules`, o `npm install` recria).
- Conferir que o `.env` está dentro da pasta copiada: ele **não está no GitHub** (está no `.gitignore`), só existe nesse backup. Sem ele o bot não sobe (token do Discord, DATABASE_URL, GUILD_ID).
- A pasta `.claude\memory_backup\` dentro do projeto é a memória do Claude Code (notas do projeto). Vai junto no backup.

## O que NÃO precisa de backup
- Código: está todo no GitHub (`henriquelamera/bot_discord_fivem`, branch `main`).
- Railway: faz deploy sozinho a cada push no `main`; as variáveis de ambiente de produção ficam lá.
- Banco de dados: é o Postgres do Railway, não tem nada local.

## Depois de formatar (restaurar)
1. Restaurar a pasta no **mesmo caminho** `c:\bot rbk` (o `.git\config` local e a memória do Claude dependem desse caminho).
2. Instalar ferramentas (PowerShell), depois **fechar e reabrir o terminal**:
   ```powershell
   winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
   winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
   ```
3. Dependências do projeto:
   ```powershell
   cd "c:\bot rbk"
   npm install
   ```
4. Git - identidade e credencial (o token antigo se perde com a formatação):
   ```powershell
   git config --global user.name "Henrique"
   git config --global user.email "henrique.carvalho@aluno.impacta.edu.br"
   git config --global credential.helper store
   ```
   Gerar um token novo em https://github.com/settings/personal-access-tokens/new
   (Repository access: só `bot_discord_fivem`; Permissions: Contents = Read and write; expiração curta).
   Depois rodar `git push origin main` uma vez num terminal normal e informar o token quando pedir;
   o `credential.helper store` guarda em `%USERPROFILE%\.git-credentials` e não pede mais.
   > O `.git\config` do projeto já tem um override (`helper =` vazio + `helper = store`) que ignora o
   > Git Credential Manager do sistema - ele volta junto com a pasta, não precisa refazer.
5. Claude Code - restaurar a memória do projeto:
   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\projects\c--bot-rbk\memory" | Out-Null
   Copy-Item "c:\bot rbk\.claude\memory_backup\*.md" "$env:USERPROFILE\.claude\projects\c--bot-rbk\memory\" -Force
   ```
   (a pasta `c--bot-rbk` vem do caminho `c:\bot rbk`; se restaurar em outro caminho o nome muda)
6. VS Code: instalar as extensões de novo (opcional; a extensão "XML" da Red Hat era só a que dava falso positivo no antivírus).

## Conferir que ficou certo
```powershell
node -v          # v24.x
git -C "c:\bot rbk" status -sb   # ## main...origin/main, sem "ahead"
git -C "c:\bot rbk" push origin main   # "Everything up-to-date", sem pedir senha
```
