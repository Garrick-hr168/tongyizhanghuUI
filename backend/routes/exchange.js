import express from "express";
import axios from "axios";
import { proxyAgent } from "../config.js";
import { authRequired } from "../auth.js";
import { markPrices } from "../binance.js"; // WS 实时价格缓存

const router = express.Router();

/* =========================
 * 现货交易对
 * ========================= */
router.get("/spotSymbols", authRequired, async (_, res) => {
  try {
    const { data } = await axios.get(
      "https://api.binance.com/api/v3/exchangeInfo",
      { httpsAgent: proxyAgent, timeout: 10000 }
    );

    res.json(
      data.symbols
        .filter(s => s.status === "TRADING")
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }))
    );
  } catch (e) {
    console.error("❌ spotSymbols", e.message);
    res.status(500).json({ error: "获取现货交易对失败" });
  }
});

/* =========================
 * USDT 永续
 * ========================= */
router.get("/usdtFuturesSymbols", authRequired, async (_, res) => {
  try {
    const { data } = await axios.get(
      "https://fapi.binance.com/fapi/v1/exchangeInfo",
      { httpsAgent: proxyAgent }
    );

    res.json(
      data.symbols
        .filter(s => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT")
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }))
    );
  } catch (e) {
    console.error("❌ usdtFuturesSymbols", e.message);
    res.status(500).json({ error: "获取 USDT 合约交易对失败" });
  }
});

/* =========================
 * 币本位永续
 * ========================= */
router.get("/coinFuturesSymbols", authRequired, async (_, res) => {
  try {
    const { data } = await axios.get(
      "https://dapi.binance.com/dapi/v1/exchangeInfo",
      { httpsAgent: proxyAgent }
    );

    res.json(
      data.symbols
        .filter(s => s.contractType === "PERPETUAL")
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }))
    );
  } catch (e) {
    console.error("❌ coinFuturesSymbols", e.message);
    res.status(500).json({ error: "获取币本位交易对失败" });
  }
});

/* =========================
 * 1️⃣ Mark Price（WS 优先，REST 兜底）
 * ========================= */
router.get("/markPrice", authRequired, async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "symbol required" });
    }

    // ✅ WS 实时缓存优先
    if (markPrices[symbol]) {
      return res.json({
        symbol,
        price: markPrices[symbol],
        source: "ws",
        time: Date.now(),
      });
    }

    // REST 兜底
    const r = await axios.get(
      "https://fapi.binance.com/fapi/v1/premiumIndex",
      { params: { symbol }, httpsAgent: proxyAgent }
    );

    res.json({
      symbol,
      price: Number(r.data.markPrice),
      source: "rest",
      time: r.data.time,
    });
  } catch (e) {
    console.error("❌ markPrice", e.message);
    res.status(500).json({ error: "mark price fetch failed" });
  }
});

/* =========================
 * 2️⃣ 强平价 / 风控计算
 * ========================= */
router.get("/riskCalc", authRequired, async (req, res) => {
  try {
    const {
      symbol,
      entryPrice,
      positionAmt,
      leverage,
      side,
    } = req.query;

    if (!symbol || !entryPrice || !positionAmt || !leverage || !side) {
      return res.status(400).json({ error: "参数不完整" });
    }

    const qty = Math.abs(Number(positionAmt));
    const price = Number(entryPrice);
    const lev = Number(leverage);

    // ⚠️ 简化模型（和 Binance 接近）
    const maintenanceMarginRate = 0.005;

    const liqPrice =
      side === "LONG"
        ? price * (1 - 1 / lev + maintenanceMarginRate)
        : price * (1 + 1 / lev - maintenanceMarginRate);

    res.json({
      symbol,
      side,
      entryPrice: price,
      leverage: lev,
      liquidationPrice: Number(liqPrice.toFixed(4)),
    });
  } catch (e) {
    console.error("❌ riskCalc", e.message);
    res.status(500).json({ error: "risk calc failed" });
  }
});

/* =========================
 * 3️⃣ / 4️⃣ 辅助信息（平仓 / 对冲）
 * ========================= */
router.get("/positionHelper", authRequired, async (req, res) => {
  const { side, positionSide } = req.query;

  res.json({
    closeSide:
      side === "BUY" ? "SELL" : "BUY",
    positionSide: positionSide || "BOTH", // 对冲模式感知
    hedgeModeSupported: true,
  });
});

export default router;
