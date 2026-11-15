# Instalação

A instalação está descrita no README principal (`README.md`, também visível no painel em **Sobre**).

Resumo:

- **Linux com systemd (recomendado)**: `curl -fsSL https://github.com/BroownTeely/noxis-uptime/releases/latest/download/install.sh | sudo bash`
- **Docker**: baixe o pacote `noxis-deploy`, copie `noxis.env.example` para `noxis.env` e execute `docker compose up -d --build`.
- **Manual**: `npm ci --omit=dev`, criar o `.env` a partir de `.env.example` e `npm start`.

Atualizações: pelo painel (**Atualização**), com `sudo bash update.sh` ou refazendo a imagem Docker.
