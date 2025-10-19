import { Router } from "express";

const ios = Router();

ios.get("/health", (_req, res) => {
  res.json({ 
    ok: true, 
    ts: new Date().toISOString(), 
    version: process.env.APP_VERSION ?? "0.1.0" 
  });
});

export default ios;
