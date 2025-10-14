// routes/version.js
import express from 'express';
import { readFileSync } from 'fs';

const router = express.Router();
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export function versionGet(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ 
    service: pkg.name || 'diy-genie-webhooks', 
    version: pkg.version || '0.0.0', 
    node: process.version 
  });
}

export function versionHead(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).end();
}

router.get('/', versionGet);
router.head('/', versionHead);

export default router;
