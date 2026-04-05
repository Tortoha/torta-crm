// import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
import { createClient } from "torta-js";

const API_URL = "http://localhost:8000/0c39355b5b6b5ac05bbc";
const API_PK  = "pk_e333e134963a8c17a09740bc28d0c2117df54da44f5c0719";

export const client = createClient(API_URL, API_PK);