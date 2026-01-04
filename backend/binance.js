import axios from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { API_SECRET, headers, proxyAgent } from "./config.js";

/* ========= 时间 ========= */
export let timeOffset = 0;

export async function syncBinanceTime() {
  const { data } = await axios.get(
    "https://api.binance.com/api/v3/time",
    { httpsAgent: proxyAgent }
  );
  timeOffset = data.serverTime - Date.now();
}

/* ========= MarkPrice WS ========= */
export const markPrices = {};

export function startMarkPriceWS() {
  const ws = new WebSocket(
    "wss://fstream.binance.com/ws/!markPrice@markPrice",
    { agent: proxyAgent }
  );

  ws.on("message", msg => {
    const arr = JSON.parse(msg.toString());
    arr.forEach(p => (markPrices[p.s] = Number(p.p)));
  });
}

/* ========= 工具 ========= */
export function signQuery(q) {
  return crypto.createHmac("sha256", API_SECRET).update(q).digest("hex");
}

export function floorToStep(v, step) {
  const p = Math.round(-Math.log10(step));
  return Number((Math.floor(v / step) * step).toFixed(p));
}

export async function getMarkPrice(symbol) {
  if (markPrices[symbol]) return markPrices[symbol];
  const { data } = await axios.get(
    `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
    { httpsAgent: proxyAgent }
  );
  return Number(data.markPrice);
}

export async function getFuturesSymbolRule(symbol) {
  const { data } = await axios.get(
    "https://fapi.binance.com/fapi/v1/exchangeInfo",
    { httpsAgent: proxyAgent }
  );

  const s = data.symbols.find(x => x.symbol === symbol);
  const lot = s.filters.find(f => f.filterType === "LOT_SIZE");

  return {
    stepSize: Number(lot.stepSize),
    minQty: Number(lot.minQty),
  };
}

