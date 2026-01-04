import dotenv from "dotenv";
import { SocksProxyAgent } from "socks-proxy-agent";

dotenv.config();

// 是否启用代理：只在你明确声明时才启用
export const USE_PROXY = process.env.USE_PROXY === "true";

export const PROXY_URL = "socks5://127.0.0.1:10808";

export const proxyAgent = USE_PROXY
  ? new SocksProxyAgent(PROXY_URL)
  : undefined;

export const API_KEY = process.env.BINANCE_API_KEY;
export const API_SECRET = process.env.BINANCE_API_SECRET;
export const JWT_SECRET = process.env.JWT_SECRET;

if (!API_KEY || !API_SECRET || !JWT_SECRET) {
  console.error("❌ 缺少环境变量");
  process.exit(1);
}

export const headers = {
  "X-MBX-APIKEY": API_KEY,
};
