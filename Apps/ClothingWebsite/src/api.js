// import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';
import { createClient } from "torta-js";

const API_URL = "http://localhost:8000/0c39355b5b6b5ac05bbc";
const API_PK  = "pk_e333e134963a8c17a09740bc28d0c2117df54da44f5c0719";

export const client = createClient(API_URL, API_PK);


/**
 * Safely extract a renderable string from a backend error response.
 *
 * Backstop for the case where `data.detail` is an array of Pydantic validation
 * error objects ({type, loc, msg, input}) — rendering that directly into JSX
 * crashes React with "Objects are not valid as a React child". Our External
 * backend overrides this globally (RequestValidationError handler flattens to
 * a string), but defence-in-depth: every UI that uses `data?.detail` should
 * route through this helper.
 *
 * @param {any} data       The parsed JSON body, or null/undefined on network error.
 * @param {string} fallback Returned when no usable error text is found.
 * @returns {string}        Always a string — safe to render with <p>{text}</p>.
 */
export function pickError(data, fallback = "Something went wrong") {
  if (!data) return fallback;
  const d = data.detail ?? data.error ?? data.message;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  // Pydantic-style: array of {type, loc, msg, input}
  if (Array.isArray(d)) {
    const parts = d.map((e) => {
      if (typeof e === "string") return e;
      const field = Array.isArray(e?.loc) ? e.loc.filter(x => x !== "body").join(".") : "input";
      return `${field}: ${e?.msg || "Invalid value"}`;
    });
    return parts.join("; ") || fallback;
  }
  // Some other unexpected shape — stringify safely
  try { return JSON.stringify(d); } catch { return fallback; }
}
