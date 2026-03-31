import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';

const API_KEY = "a3f8d2e1b4c7f9a0e5d3b6c8f2a1e4d7b9c0f3a6e8d1b5c7f0a2e9d4b8c6f1a3";

export const client = createClient("http://localhost:8000", API_KEY);