// import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
import { createClient } from "torta-js";

const API_URL = "http://localhost:8000/0c39355b5b6b5ac05bbc";
const API_PK  = "pk_e333e134963a8c17a09740bc28d0c2117df54da44f5c0719";

// const API_URL = "https://api.tortacrm.com/350182f078d162956749";
// const API_PK  = "pk_e9044065d06d33f1c3fa03dc60d445cb39ca0c022e8873c9";

export const client = createClient(API_URL, API_PK);