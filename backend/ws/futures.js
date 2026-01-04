import WebSocket from "ws";

export function startFuturesWS(onData) {
  const ws = new WebSocket(
    "wss://fstream.binance.com/ws/btcusdt@markPrice@1s/btcusdt@depth5@100ms"
  );

  ws.on("open", () => {
    console.log("📡 Futures WS connected");
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
    onData(data);
  });

  ws.on("close", () => {
    console.log("❌ Futures WS closed");
  });

  ws.on("error", (e) => {
    console.error("WS error", e.message);
  });
}
