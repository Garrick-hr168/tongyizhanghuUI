import express from "express";
import axios from "axios";
import {
  getMarkPrice,
  getFuturesSymbolRule,
  floorToStep,
  signQuery,
  timeOffset,
  markPrices,
} from "../binance.js";
import { headers, proxyAgent } from "../config.js";
import { authRequired } from "../auth.js";

/* ===============================
 * 清除已有 TP / SL（不影响主单）
 * =============================== */
async function clearTPSL(symbol, positionSide) {
  const ts = Date.now() + timeOffset;
  const q = `symbol=${symbol}&timestamp=${ts}&recvWindow=10000`;

  const { data } = await axios.get(
    `https://fapi.binance.com/fapi/v1/openOrders?${q}&signature=${signQuery(q)}`,
    { headers, httpsAgent: proxyAgent }
  );

  const targets = data.filter(
    o =>
      o.positionSide === positionSide &&
      ["STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(o.type)
  );

  for (const o of targets) {
    const cq =
      `symbol=${symbol}&orderId=${o.orderId}` +
      `&timestamp=${Date.now() + timeOffset}`;

    await axios.delete(
      `https://fapi.binance.com/fapi/v1/order?${cq}&signature=${signQuery(cq)}`,
      { headers, httpsAgent: proxyAgent }
    );
  }
}


const router = express.Router();

/**
 * ===============================
 * USDT 永续合约下单（闭环）
 * Hedge Mode / USDT 数量
 * ===============================
 */
router.post("/", authRequired, async (req, res) => {
  try {
    const {
      tradeType = "USDT_FUTURES",
      symbol,
      side,
      usdtAmount,
      leverage = 1,
      stopLoss,
      takeProfit,
    } = req.body;

    /* ========= 0️⃣ 参数校验 ========= */
    if (tradeType !== "USDT_FUTURES") {
      return res.status(400).json({ error: "仅支持 USDT 永续合约" });
    }

    if (!symbol || !side || !usdtAmount) {
      return res.status(400).json({ error: "参数不完整" });
    }

    if (!["BUY", "SELL"].includes(side)) {
      return res.status(400).json({ error: "side 必须是 BUY / SELL" });
    }

    if (usdtAmount <= 0) {
      return res.status(400).json({ error: "USDT 数量非法" });
    }

    /* ========= 1️⃣ 仓位方向（Hedge Mode 核心） ========= */
    const positionSide = side === "BUY" ? "LONG" : "SHORT";
    const closeSide = side === "BUY" ? "SELL" : "BUY";

    /* ========= 2️⃣ 获取标记价格 ========= */
    const price =
      markPrices[symbol] || (await getMarkPrice(symbol));

    if (!price) {
      return res.status(400).json({ error: "无法获取标记价格" });
    }

    /* ========= 3️⃣ 交易规则 ========= */
    const { stepSize, minQty } = await getFuturesSymbolRule(symbol);

    /* ========= 4️⃣ 计算下单数量 ========= */
    const rawQty = usdtAmount / price;
    const quantity = floorToStep(rawQty, stepSize);

    if (quantity < minQty) {
      return res.status(400).json({
        error: `下单数量过小，最小 ${minQty}`,
      });
    }

    /* ========= 5️⃣ 设置杠杆 ========= */
    const leverageTs = Date.now() + timeOffset;
    const leverageQuery =
      `symbol=${symbol}` +
      `&leverage=${leverage}` +
      `&timestamp=${leverageTs}` +
      `&recvWindow=10000`;

    await axios.post(
      `https://fapi.binance.com/fapi/v1/leverage?${leverageQuery}&signature=${signQuery(leverageQuery)}`,
      null,
      { headers, httpsAgent: proxyAgent }
    );

    /* ========= 6️⃣ 下主单（MARKET） ========= */
    const orderTs = Date.now() + timeOffset;
    const orderQuery =
      `symbol=${symbol}` +
      `&side=${side}` +
      `&positionSide=${positionSide}` +
      `&type=MARKET` +
      `&quantity=${quantity}` +
      `&timestamp=${orderTs}` +
      `&recvWindow=10000`;

    const orderRes = await axios.post(
      `https://fapi.binance.com/fapi/v1/order?${orderQuery}&signature=${signQuery(orderQuery)}`,
      null,
      { headers, httpsAgent: proxyAgent }
    );

    /* ========= 7️⃣ 止盈 / 止损（可选） ========= */
    async function placeTPSL(type, stopPrice) {
      const ts = Date.now() + timeOffset;
      const q =
        `symbol=${symbol}` +
        `&side=${closeSide}` +
        `&positionSide=${positionSide}` +
        `&type=${type}` +
        `&stopPrice=${stopPrice}` +
        `&closePosition=true` +
        `&timestamp=${ts}` +
        `&recvWindow=10000`;

      await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${q}&signature=${signQuery(q)}`,
        null,
        { headers, httpsAgent: proxyAgent }
      );
    }

    if (stopLoss) await placeTPSL("STOP_MARKET", stopLoss);
    if (takeProfit) await placeTPSL("TAKE_PROFIT_MARKET", takeProfit);

/**
 * ===============================
 * 修改已有仓位的止盈 / 止损（新增）
 * ===============================
 */
router.post("/setStops", authRequired, async (req, res) => {
  try {
    const { symbol, side, stopLoss, takeProfit } = req.body;

    if (!symbol || !side) {
      return res.status(400).json({ error: "参数不完整" });
    }

    const positionSide = side === "LONG" ? "LONG" : "SHORT";
    const openSide = positionSide === "LONG" ? "BUY" : "SELL";
    const closeSide = openSide === "BUY" ? "SELL" : "BUY";

    /* 1️⃣ 清掉旧的 TP / SL */
    await clearTPSL(symbol, positionSide);

    /* 2️⃣ 重新设置 */
    async function place(type, stopPrice) {
      const ts = Date.now() + timeOffset;
      const q =
        `symbol=${symbol}` +
        `&side=${closeSide}` +
        `&positionSide=${positionSide}` +
        `&type=${type}` +
        `&stopPrice=${stopPrice}` +
        `&closePosition=true` +
        `&timestamp=${ts}` +
        `&recvWindow=10000`;

      await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${q}&signature=${signQuery(q)}`,
        null,
        { headers, httpsAgent: proxyAgent }
      );
    }

    if (stopLoss) await place("STOP_MARKET", stopLoss);
    if (takeProfit) await place("TAKE_PROFIT_MARKET", takeProfit);

    res.json({ success: true });
  } catch (e) {
    console.error("❌ setStops error:", e.response?.data || e.message);
    res.status(500).json({
      success: false,
      error: e.response?.data?.msg || e.message,
    });
  }
});


    /* ========= 8️⃣ 获取账户快照（闭环） ========= */
    const accTs = Date.now() + timeOffset;
    const accQuery =
      `timestamp=${accTs}&recvWindow=10000`;

    const accRes = await axios.get(
      `https://fapi.binance.com/fapi/v2/account?${accQuery}&signature=${signQuery(accQuery)}`,
      { headers, httpsAgent: proxyAgent }
    );

    const position = accRes.data.positions.find(
      p =>
        p.symbol === symbol &&
        p.positionSide === positionSide &&
        Number(p.positionAmt) !== 0
    );

    /* ========= 9️⃣ 返回完整闭环结果 ========= */
    res.json({
      success: true,
      order: {
        symbol,
        side,
        positionSide,
        usdtAmount,
        price,
        quantity,
        leverage,
        orderId: orderRes.data.orderId,
      },
      accountSnapshot: {
        availableUSDT: Number(accRes.data.availableBalance),
        position: position
          ? {
              symbol,
              side: positionSide,
              positionAmt: Number(position.positionAmt),
              entryPrice: Number(position.entryPrice),
              markPrice: price,
              unrealizedProfit: Number(position.unrealizedProfit),
            }
          : null,
      },
    });
  } catch (e) {
    console.error("❌ order error:", e.response?.data || e.message);
    res.status(500).json({
      success: false,
      error: e.response?.data?.msg || e.message,
    });
  }
});

export default router;
