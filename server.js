
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static("public"));

let live = null;

let state = {
  connected: false,
  username: "",
  running: false,
  finished: false,
  round: 1,
  roundDurationSeconds: 600,
  startedAt: null,
  endsAt: null,
  lula: 0,
  flavio: 0,
  history: [],
  message: "Conecte-se à LIVE para começar."
};

function publicState() {
  const remaining =
    state.running && state.endsAt
      ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000))
      : 0;

  return {
    ...state,
    remaining,
    winner: state.finished
      ? state.lula === state.flavio
        ? "draw"
        : state.lula > state.flavio
          ? "lula"
          : "flavio"
      : null
  };
}

function broadcast() {
  const message = JSON.stringify({
    type: "state",
    state: publicState()
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function finishRound() {
  if (!state.running) return;

  state.running = false;
  state.finished = true;

  const result =
    state.lula === state.flavio
      ? "Empate"
      : state.lula > state.flavio
        ? "Lula venceu"
        : "Flávio Bolsonaro venceu";

  state.history.push({
    round: state.round,
    lula: state.lula,
    flavio: state.flavio,
    result,
    endedAt: new Date().toISOString()
  });

  state.message = result;
  broadcast();
}

setInterval(() => {
  if (state.running && Date.now() >= state.endsAt) {
    finishRound();
  } else if (state.running) {
    broadcast();
  }
}, 1000);

wss.on("connection", socket => {
  socket.send(JSON.stringify({
    type: "state",
    state: publicState()
  }));
});

app.get("/api/state", (_, res) => {
  res.json(publicState());
});

app.post("/api/connect", async (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .replace(/^@/, "");

  if (!username) {
    return res.status(400).json({
      error: "Informe o usuário público do TikTok."
    });
  }

  try {
    if (live) {
      try {
        await live.disconnect();
      } catch (_) {}
    }

    state.connected = false;
    state.username = username;
    state.message = "Tentando conectar à LIVE de @" + username;
    broadcast();

    live = new TikTokLiveConnection(username, {
      enableExtendedGiftInfo: true,
      processInitialData: false
    });

    live.on(WebcastEvent.GIFT, gift => {
      if (!state.running) return;
      if (!gift.gift) return;

      // Presentes em sequência só são contabilizados ao terminar.
      if (gift.gift.type === 1 && gift.repeatEnd !== 1) return;

      const name = String(
        gift.gift.name || gift.extendedGiftInfo?.name || ""
      ).toLowerCase().trim();

      const count = Math.max(1, Number(gift.repeatCount || 1));

      if (name === "rose" || name === "rosa") {
        state.lula += count;
      } else if (
        name === "white rose" ||
        name === "rosa branca" ||
        name === "white_rose"
      ) {
        state.flavio += count;
      } else {
        return;
      }

      broadcast();
    });

    await live.connect();

    state.connected = true;
    state.username = username;
    state.message = "Conectado à LIVE de @" + username;

    broadcast();
    res.json({ ok: true, state: publicState() });
  } catch (error) {
    state.connected = false;
    state.message =
      "Falha na conexão: " + (error.message || "erro desconhecido");

    broadcast();
    res.status(502).json({ error: state.message });
  }
});

app.post("/api/start", (req, res) => {
  if (!state.connected) {
    return res.status(400).json({
      error: "Conecte-se à LIVE antes de iniciar."
    });
  }

  if (state.running) {
    return res.status(400).json({
      error: "O turno já está em andamento."
    });
  }

  state.lula = 0;
  state.flavio = 0;
  state.finished = false;
  state.running = true;
  state.startedAt = Date.now();
  state.endsAt = state.startedAt + state.roundDurationSeconds * 1000;
  state.message = "Turno " + state.round + " em andamento!";

  broadcast();
  res.json({ ok: true, state: publicState() });
});

app.post("/api/end", (_, res) => {
  finishRound();
  res.json({ ok: true, state: publicState() });
});

app.post("/api/next", (_, res) => {
  if (!state.finished) {
    return res.status(400).json({
      error: "Finalize o turno atual primeiro."
    });
  }

  state.round++;
  state.lula = 0;
  state.flavio = 0;
  state.finished = false;
  state.startedAt = null;
  state.endsAt = null;
  state.running = false;
  state.message = "Pronto para o turno " + state.round + ".";

  broadcast();
  res.json({ ok: true, state: publicState() });
});

app.post("/api/reset", (_, res) => {
  const connected = state.connected;
  const username = state.username;

  state = {
    connected,
    username,
    running: false,
    finished: false,
    round: 1,
    roundDurationSeconds: 600,
    startedAt: null,
    endsAt: null,
    lula: 0,
    flavio: 0,
    history: [],
    message: "Contagem reiniciada."
  };

  broadcast();
  res.json({ ok: true, state: publicState() });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log("Painel de votação na porta " + port);
});
