# Noxis Uptime

Sistema de monitoramento de infraestrutura **self-hosted**, feito para homelab e self-hosting. Monitore sites, APIs, portas, containers, certificados SSL e serviços da sua rede, com painel em tempo real, alertas, páginas de status e um mapa das dependências entre os serviços.

Repositório: https://github.com/BroownTeely/noxis-uptime

> Este projeto foi desenvolvido com o auxílio de **inteligência artificial** (Claude, da Anthropic), com revisão, testes e decisões de arquitetura feitos pelo mantenedor.

---

## O que é

O Noxis Uptime roda no seu próprio servidor, sem depender de serviços externos. Ele verifica seus serviços em intervalos configuráveis, registra o histórico, detecta quedas com confirmação (sem alarmes falsos), abre incidentes automaticamente e avisa você pelos canais que escolher.

Ele não envia dados para terceiros. O banco é um arquivo SQLite no seu servidor.

## Recursos

**Monitoramento**
- HTTP/HTTPS (método, cabeçalhos, autenticação, status esperado, redirecionamentos validados)
- Monitor de API (GET, POST, PUT, PATCH, DELETE; corpo JSON; Bearer, Basic ou API key; chaves obrigatórias na resposta)
- Palavra-chave e JSON Query
- Porta TCP, PING/ICMP, DNS (vários tipos de registro e valor esperado)
- Certificado SSL/TLS com alertas em 30, 14, 7, 3 e 1 dia (configuráveis)
- Heartbeat (scripts, backups, CRON)
- Containers Docker (somente leitura)

**Operação**
- Dependências entre monitores (obrigatórias e opcionais), com análise de causa raiz e supressão de alertas em cascata
- Mapa visual da infraestrutura
- Incidentes automáticos, reconhecimento, atualizações e histórico
- Manutenções programadas
- Relatórios de disponibilidade com exportação CSV
- Backup do banco pela interface

**Descoberta (somente redes privadas)**
- Varredura de portas TCP na sua LAN, com portas comuns de homelab e confirmação explícita. Nenhum monitor é criado sem a sua escolha.

**Notificações**
- Discord (embeds, menções), ntfy (self-hosted), Telegram e webhook HTTP com assinatura HMAC-SHA256
- Modo de simulação para testar sem internet

**Páginas de status**
- Várias páginas, públicas ou privadas (com login ou link secreto), personalizáveis (tema, cor, logo, favicon, domínio próprio)

**Painel**
- Tempo real via Socket.IO, sem recarregar a página
- Temas claro, escuro e automático
- Usuários com papéis: owner, admin, editor e viewer
- Chaves de API, logs de auditoria, modals para formulários

## Como funciona

```
app.js                 ponto de entrada: banco, motor, notificações, Socket.IO, servidor HTTP
src/
  config/              configuração (variáveis de ambiente e padrões)
  db/                  SQLite (WAL), migrations versionadas e repositórios
  monitors/            motor de agendamento e verificadores (um por tipo de monitor)
  services/            regras de negócio (monitores, incidentes, dependências, status pages, atualização)
  notifications/       canais, fila de envio com retentativas e tratamento de HTTP 429
  events/              barramento interno de eventos que liga os módulos
  sockets/             atualizações em tempo real para o painel
  routes/ controllers/ API REST e páginas EJS
  views/ public/       interface (EJS, CSS e JavaScript sem build)
```

**Motor de monitoramento.** Cada monitor tem o seu próprio temporizador. Um limite de concorrência global evita sobrecarga, e uma verificação nunca roda duas vezes ao mesmo tempo. Uma falha só vira queda depois do número de tentativas configurado, o que evita alarmes falsos.

**Eventos.** Quando um estado muda (por exemplo, de UP para DOWN), o motor publica um evento. Os incidentes, as notificações e o painel reagem a esse evento sem depender uns dos outros.

**Dependências.** Se o banco de dados cai e a API depende dele, o sistema identifica a causa raiz e envia um único alerta, listando os serviços afetados. A API aparece como DEGRADED, sem que o estado armazenado seja alterado.

**Segurança.** Senhas com scrypt, sessões em cookie `httpOnly`, proteção CSRF, validação de destinos (bloqueio de metadados de nuvem, redirecionamentos validados), segredos mascarados nas respostas e auditoria de ações sensíveis.

## Requisitos de sistema

| Item | Mínimo | Recomendado |
|---|---|---|
| Sistema | Linux com systemd (Ubuntu Server 24.04 LTS testado) ou Docker 24+ | Ubuntu Server 24.04 LTS |
| Node.js | 22.13 ou superior (instalado automaticamente pelo script) | 22 LTS |
| Processador | 1 vCPU | 2 vCPU |
| Memória RAM | 512 MB | 1 GB |
| Disco | 500 MB livres | 2 GB (histórico cresce com o tempo) |
| Rede | Acesso de saída para verificar seus serviços e para o GitHub (atualizações) | Idem |
| Porta | 8417 padrão; o instalador escolhe uma aleatória de 4 dígitos | Idem |
| Pacotes | `iputils-ping` (para PING), `curl`, `unzip` | Idem |
| Navegador | Chrome, Edge, Firefox ou Safari recentes | Idem |

Não é necessário ter domínio público. O sistema funciona na rede local, em VPS e atrás de Cloudflare Tunnel ou de um proxy reverso.

## Instalação

### Linux com systemd (recomendado)

Instala a última release, verifica o checksum SHA-256, cria o usuário `noxis`, instala o Node.js 22 se necessário e registra o serviço:

```bash
curl -fsSL https://github.com/BroownTeely/noxis-uptime/releases/latest/download/install.sh | sudo bash
```

Versão específica:

```bash
curl -fsSL https://github.com/BroownTeely/noxis-uptime/releases/latest/download/install.sh | sudo VERSION=v1.0.0 bash
```

O instalador escolhe uma porta aleatória de 4 dígitos (1000 a 9999), livre no servidor, e mostra o endereço no final. Acesse `http://IP-DO-SERVIDOR:PORTA` e crie a conta owner em `/setup`. Para usar uma porta específica: `sudo PORT=8417 bash install.sh`.

Porta externa diferente: `PORT_PUBLISHED=3210 docker compose up -d --build`.

### Manual (desenvolvimento ou outros sistemas)

```bash
git clone https://github.com/BroownTeely/noxis-uptime.git
cd noxis-uptime
npm ci --omit=dev
cp .env.example .env                    # defina APP_SECRET
npm start
```

## Configuração

Principais variáveis (arquivo `.env`):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | 8417 | Porta HTTP (o instalador gera uma aleatória de 4 dígitos) |
| `APP_SECRET` | aleatório | Defina sempre em produção |
| `DATABASE_PATH` | `storage/database/noxis.db` | Arquivo do banco |
| `COOKIE_SECURE` | false | `true` quando servido por HTTPS |
| `TRUST_PROXY` | 1 | Proxies confiáveis à frente (Cloudflare Tunnel, nginx) |
| `MAX_CONCURRENT_CHECKS` | 20 | Verificações em paralelo |
| `DOCKER_SOCKET` | vazio | Socket para monitores Docker (somente leitura) |
| `NOXIS_NOTIFY_DRY_RUN` | false | Simula notificações sem contatar destinos |

Detalhes em `src/docs/CONFIGURATION.md`.

## Atualizações

O sistema verifica a última release no GitHub a cada 6 horas. Quando há uma versão nova:

1. **Baixa e verifica** o pacote automaticamente (checksum SHA-256 publicado com a release). Nada é instalado sem a sua confirmação.
2. **Avisa** com um banner no painel e uma notificação em todos os canais ativos. O aviso é enviado uma vez por versão e repetido a cada 24 horas enquanto a atualização estiver pendente.
3. **Você decide quando aplicar**, em **Atualização** no painel (apenas administradores). Antes de instalar, o sistema faz backup do banco e do código. Se a instalação falhar, a versão anterior é restaurada automaticamente.

Em Docker, a atualização é feita refazendo a imagem com a nova versão (`NOXIS_REF=vX.Y.Z docker compose up -d --build`), porque o código dentro do container não deve ser alterado pela interface. Em instalações com systemd também é possível atualizar pelo terminal com `sudo bash update.sh`.

O download automático pode ser desligado em **Configurações → Sistema**.

## Roteiro de futuras atualizações

Próximas funções planejadas, em ordem aproximada de prioridade:

- **Descoberta de sites (HTTP)**: a partir de uma URL, identificar endpoints públicos, favicon e sitemap, sugerindo monitores para você confirmar.
- **E-mail (SMTP)**: canal de notificação por e-mail, com recuperação de senha.
- **Agente para serviços locais**: monitorar serviços systemd e métricas de CPU, memória e disco de cada servidor.
- **Restauração de backup pela interface**, com confirmação e verificação de integridade.
- **Mapa ao vivo**: atualização dos estados sem recarregar a página.
- **Editor de status pages com arrastar e soltar**.

Sugestões são bem-vindas.

## Sugestões e suporte

Para sugestões de funções, relatos de problemas ou suporte, escreva para **brownteely@outlook.com.br**. Ao relatar um problema, informe a versão (aparece na página Sobre), o método de instalação (script, Docker ou manual) e, se possível, o trecho de log relevante (`journalctl -u noxis-uptime -e` ou `docker compose logs`).

Também é possível abrir uma *issue* no repositório: https://github.com/BroownTeely/noxis-uptime/issues

## Licença

MIT. Veja `LICENSE`.
