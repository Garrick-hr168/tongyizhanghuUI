import express from "express";
import axios from "axios";
import { headers, proxyAgent } from "../config.js";
import { signQuery, timeOffset, markPrices } from "../binance.js";
import { authRequired } from "../auth.js";

const router = express.Router();

// Mock / 实现 getFuturesAccount
export async function getFuturesAccount(user) {
  // 如果想调用 Binance API 获取合约账户信息，也可以在这里写
  return {
    balance: 1000,
    positions: [],
  };
}

// /account/futuresAccount → 前端请求的接口
router.get("/futuresAccount", authRequired, async (req, res) => {
  try {
    const accountData = await getFuturesAccount(req.user);
    res.json(accountData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========= 现货账户 ========= */
router.get("/", authRequired, async (req, res) => {
  try {
    const ts = Date.now() + timeOffset;
    const q = `timestamp=${ts}&recvWindow=10000`;
    const sig = signQuery(q);

    const { data } = await axios.get(
      `https://api.binance.com/api/v3/account?${q}&signature=${sig}`,
      { headers, httpsAgent: proxyAgent }
    );

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

/* ========= 合约账户 ========= */
router.get("/futures", authRequired, async (req, res) => {
  try {
    const ts = Date.now() + timeOffset;
    const q = `timestamp=${ts}&recvWindow=10000`;
    const sig = signQuery(q);

    const { data } = await axios.get(
      `https://fapi.binance.com/fapi/v2/account?${q}&signature=${sig}`,
      { headers, httpsAgent: proxyAgent }
    );

    const positions = data.positions
      .filter(p => Number(p.positionAmt) !== 0)
      .map(p => {
        const amt = Number(p.positionAmt);
        const mark = markPrices[p.symbol] ?? Number(p.markPrice);
        return {
          symbol: p.symbol,
          side: amt > 0 ? "LONG" : "SHORT",
          positionAmt: amt,
          entryPrice: Number(p.entryPrice),
          markPrice: mark,
          notional: Math.abs(amt * mark),
          unrealizedProfit: Number(p.unrealizedProfit),
          leverage: Number(p.leverage),
        };
      });

    res.json({ positions });
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

/* ========= 统一账户概览 ========= */
router.get("/overview", authRequired, async (req, res) => {
  try {
    const ts = Date.now() + timeOffset;
    const q = `timestamp=${ts}&recvWindow=10000`;
    const sig = signQuery(q);

    const [spot, futures] = await Promise.all([
      axios.get(
        `https://api.binance.com/api/v3/account?${q}&signature=${sig}`,
        { headers, httpsAgent: proxyAgent }
      ),
      axios.get(
        `https://fapi.binance.com/fapi/v2/account?${q}&signature=${sig}`,
        { headers, httpsAgent: proxyAgent }
      ),
    ]);

    const balances = spot.data.balances
      .map(b => ({
        asset: b.asset,
        free: Number(b.free),
        locked: Number(b.locked),
      }))
      .filter(b => b.free + b.locked > 0);

    const usdt = balances.find(b => b.asset === "USDT");

    res.json({
      spot: {
        totalUSDT: (usdt?.free || 0) + (usdt?.locked || 0),
        availableUSDT: usdt?.free || 0,
        assets: balances,
      },
      futures: {
        walletBalance: Number(futures.data.totalWalletBalance || 0),
        availableBalance: Number(futures.data.availableBalance || 0),
        unrealizedPNL: Number(futures.data.totalUnrealizedProfit || 0),
      },
    });
  } catch (e) {
    res.status(500).json({ error: "获取账户概览失败" });
  }
});

export default router;
