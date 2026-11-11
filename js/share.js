// Shareable links (SPEC §11): the document is packed into the page address after "#d=", so a link carries the whole
// curve and nothing is uploaded anywhere. Pure apart from the standard CompressionStream; no DOM.
import { loadDoc } from "./doc.js";

/** Longest link text (after "#d=") that will be decoded. */
export const MAX_SHARE_CHARS = 200_000;
/** Largest document JSON a link may unpack to; stops a tiny link that expands to something huge. */
export const MAX_SHARE_JSON = 2_000_000;
/** Above this many characters a link may be cut off by chat apps and mail; the page says so. */
export const LONG_LINK = 2000;

const TOO_LARGE = "That link is too large.";

const toBase64Url = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function collect(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(TOO_LARGE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const pipe = (bytes, transform, limit) => collect(new Blob([bytes]).stream().pipeThrough(transform), limit);

/**
 * Pack a document into link text. The imported original, its header and any reference trace are left out: a link
 * is for the curve you built, and those can be large.
 * @param {object} doc
 * @returns {Promise<string>} the text to put after "#d="
 */
export async function encodeShare(doc) {
  const slim = JSON.parse(JSON.stringify(doc));
  slim.original = null;
  slim.originalProps = null;
  delete slim.template;
  if (slim.grid?.mode === "original") slim.grid.mode = "resample"; // that grid needs the original
  const json = JSON.stringify({ v: 1, doc: slim });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"), MAX_SHARE_JSON);
  return toBase64Url(packed);
}

/**
 * Unpack and validate link text. Everything goes through loadDoc, so a hostile link can't create anything a
 * saved file couldn't.
 * @param {string} text what follows "#d="
 * @returns {Promise<object>} a clean document
 */
export async function decodeShare(text) {
  const notOurs = "That link isn't a Target Curve Builder link.";
  if (typeof text !== "string" || !text || text.length > MAX_SHARE_CHARS || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(notOurs);
  let bytes;
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(notOurs);
  }
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_SHARE_JSON));
  } catch (e) {
    throw new Error(e.message === TOO_LARGE ? TOO_LARGE : "That link is damaged or incomplete.");
  }
  let obj;
  try { obj = JSON.parse(json); } catch { throw new Error("That link is damaged or incomplete."); }
  if (!obj || obj.v !== 1) throw new Error("That link is from a different version.");
  return loadDoc(obj.doc);
}
