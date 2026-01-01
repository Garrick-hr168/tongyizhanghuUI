import express from "express";
import cors from "cors";

import { syncBinanceTime, startMarkPriceWS } from "./binance.js";
import { loginHandler, authRequired } from "./auth.js";

import exchangeRoutes from "./routes/exchange.js";
import accountRoutes from "./routes/account.js";
import orderRoutes from "./routes/order.js";
/***********************
 * 创建 app（必须最先）
 ***********************/
const app = express();

/***********************
 * 中间件
 ***********************/
app.use(cors());
app.use(express.json());

/***********************
 * 公共接口
 ***********************/
app.get("/", (_, res) => {
  res.json({ ok: true });
});

app.post("/login", loginHandler);

/***********************
 * 需要登录的接口
 ***********************/
app.use("/exchange", exchangeRoutes);
app.use("/account", accountRoutes);
app.use("/order", orderRoutes);
/***********************
 * 启动
 ***********************/
(async () => {
  await syncBinanceTime();
  startMarkPriceWS();
  app.listen(3001, () => {
    console.log("🚀 Backend running at http://localhost:3001");
  });
})();
