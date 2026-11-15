# Desenvolvimento

- `npm run dev` inicia com recarregamento automático.
- `npm test` executa os testes em `src/tests/unit` com `node:test`.
- Migrations: adicione uma nova entrada em `src/db/migrations.js`. Não altere migrations já publicadas.
- Novo tipo de monitor: crie `src/monitors/checks/<tipo>.js` que retorne `{ ok, latencyMs, message, details }`, registre-o em `src/monitors/checks/index.js` e adicione validação em `src/validators/monitor.validator.js`.
- Novo canal de notificação: implemente o provedor em `src/notifications/providers/` e a regra de envio no gerenciador.
- Timestamps são sempre ISO 8601 em UTC no banco; a exibição usa o fuso configurado.

## Publicar uma release

1. Atualize a versão em `package.json` (ex.: `1.0.1`) e faça commit.
2. Crie a tag e envie: `git tag v1.0.1 && git push origin main v1.0.1`.
3. O workflow `.github/workflows/release.yml` confere a versão, roda os testes, gera o ZIP, o `SHA256SUMS.txt` e o `install.sh`, e publica a release com todos os arquivos.

Os scripts de release ficam em `.github/release-assets/`. Gerar localmente: `bash .github/release-assets/make-release.sh . v1.0.1` (saída em `.github/release-assets/dist/`).
