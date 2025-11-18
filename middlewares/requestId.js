import { randomUUID } from "crypto";

export default function requestId(req, res, next) {
  req.id = req.get("X-Request-ID") || randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
}

