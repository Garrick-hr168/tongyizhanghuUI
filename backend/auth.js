import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config.js";

export const USERS = [
  { username: "admin", passwordHash: bcrypt.hashSync("admin123", 10), role: "admin" },
  { username: "trader", passwordHash: bcrypt.hashSync("trade123", 10), role: "trader" },
  { username: "viewer", passwordHash: bcrypt.hashSync("view123", 10), role: "viewer" },
];

export function loginHandler(req, res) {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, username: user.username, role: user.role });
}

export function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "登录已失效" });
  }

  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "登录已失效" });
  }
}
